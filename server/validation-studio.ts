export type ValidationStudioContext = {
  tool: (name: string, args: any, timeout?: number) => Promise<any>;
  studioId: string;
  taskId: string;
  attempt: number;
  lease: () => void;
  identity: () => Promise<any>;
  getCandidateIds: () => string[];
  /** Optional validation protocol. Omission preserves the original skills profile. */
  profile?: "sypho-skills" | "sypho-motion";
};

export const validationStudioToolDefinitions = [
  {
    name: "probe_sfx",
    description:
      "Fixed safe audio candidate validation in the confirmed Play session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "measure", "play", "cleanup"],
        },
        ids: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    },
  },
  {
    name: "validation_control",
    description:
      "Read-only authored scene comparison and fixed device simulator controls.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["before", "after", "mobile", "default"],
        },
      },
    },
  },
] as const;

const roots = [
  "Workspace",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPlayer",
  "Lighting",
  "SoundService",
];
function decode(value: any): any {
  for (let i = 0; i < 3; i++) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        return value;
      }
    }
    if (value?.structuredContent !== undefined) {
      value = value.structuredContent;
      continue;
    }
    const texts = value?.content
      ?.filter((x: any) => x?.type === "text")
      .map((x: any) => x.text);
    if (texts?.length) {
      value = texts.join("\n");
      continue;
    }
    if (value?.result !== undefined) {
      value = value.result;
      continue;
    }
    break;
  }
  return value;
}
function validateShape(action: string, args: any, hasIds: boolean) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).some((k) => !["action", "ids"].includes(k)) ||
    args.action !== action
  )
    throw new Error("Invalid fixed tool input");
  if (hasIds) {
    if (
      !Array.isArray(args.ids) ||
      args.ids.length < 1 ||
      args.ids.length > 3 ||
      new Set(args.ids).size !== args.ids.length ||
      args.ids.some((id: any) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new Error("ids must be 1–3 unique positive safe integers");
  } else if (args.ids !== undefined)
    throw new Error("ids are not accepted for this action");
}

export function createValidationStudio(context: ValidationStudioContext) {
  const folder = `__SyphoSkillProbe_${context.taskId.slice(0, 8)}`;
  let created: number[] | null = null;
  let fingerprint: { hash: string; count: number } | null = null;
  async function call(code: string, dm: string) {
    context.lease();
    await context.identity();
    context.lease();
    const state = decode(
      await context.tool("get_studio_state", { studio_id: context.studioId }),
    );
    context.lease();
    const raw = typeof state === "string" ? state : JSON.stringify(state);
    const currentMode = raw
      .match(/Current Studio Mode\s*:\s*([^\r\n"]+)/i)?.[1]
      ?.trim();
    if (
      dm === "Play"
        ? !/^Play\b/i.test(currentMode || "")
        : !/^Edit\b/i.test(currentMode || "")
    )
      throw new Error(`Studio is not in confirmed ${dm} mode`);
    const available =
      raw.match(/Available DataModels\s*:\s*([^\r\n"]+)/i)?.[1] ?? "";
    if (
      dm === "Play"
        ? !/\b(?:Server|Client)\b/i.test(available)
        : !/\bEdit\b/i.test(available)
    )
      throw new Error(`Studio is not in confirmed ${dm} datamodel`);
    const result = await context.tool("execute_luau", {
      studio_id: context.studioId,
      datamodel_type:
        dm === "Play"
          ? /\bServer\b/i.test(available)
            ? "Server"
            : "Client"
          : "Edit",
      code,
    });
    context.lease();
    if (result?.isError) throw new Error("Fixed Studio operation failed");
    return decode(result);
  }
  const meta = (action: string, data: any = {}) => ({
    profile: context.profile ?? "sypho-skills",
    taskId: context.taskId,
    attempt: context.attempt,
    action,
    probePath: `SoundService.${folder}`,
    ...data,
  });
  async function probeSfx(args: any) {
    const action = args?.action;
    if (!["create", "measure", "play", "cleanup"].includes(action))
      throw new Error("Invalid action");
    validateShape(action, args, action === "create");
    if (action === "create") {
      const candidateIds = context.getCandidateIds();
      if (
        args.ids.some(
          (id: number) =>
            !candidateIds.includes(String(id)) &&
            !candidateIds.includes(id as any),
        )
      )
        throw new Error("Unknown candidate ID");
      const ids = args.ids as number[];
      const code = `local S=game:GetService("SoundService"); if S:FindFirstChild(${JSON.stringify(folder)}) then error("probe exists") end; local f=Instance.new("Folder"); f.Name=${JSON.stringify(folder)}; f:SetAttribute("TaskId",${JSON.stringify(context.taskId)}); f:SetAttribute("Attempt",${context.attempt}); f.Parent=S; ${ids.map((id, i) => `local s${i}=Instance.new("Sound"); s${i}.Name=${JSON.stringify(String(id))}; s${i}.SoundId="rbxassetid://${id}"; s${i}.Volume=0.2; s${i}.Parent=f;`).join(" ")} return "created"`;
      await call(code, "Play");
      created = ids.slice();
      return meta(action, { createdIds: created });
    }
    if (action === "measure" || action === "play") {
      if (!created?.length) throw new Error("No host-created probe is active");
      if (action === "play") {
        await call(
          `local f=game:GetService("SoundService"):FindFirstChild(${JSON.stringify(folder)}); if not f or f:GetAttribute("TaskId")~=${JSON.stringify(context.taskId)} or f:GetAttribute("Attempt")~=${context.attempt} then error("ownership mismatch") end; local s=f:FindFirstChild(${JSON.stringify(String(created[0]))}); if not s or not s:IsA("Sound") then error("sound missing") end; s:Play(); return "played"`,
          "Play",
        );
        return meta(action, { playedId: created[0] });
      }
      const out = await call(
        `local f=game:GetService("SoundService"):FindFirstChild(${JSON.stringify(folder)}); if not f or f:GetAttribute("TaskId")~=${JSON.stringify(context.taskId)} or f:GetAttribute("Attempt")~=${context.attempt} then error("ownership mismatch") end; local r={}; ${created.map((id) => `local s=f:FindFirstChild(${JSON.stringify(String(id))}); if s and s:IsA("Sound") then local deadline=os.clock()+10; repeat task.wait(0.25) until s.IsLoaded or os.clock()>=deadline; table.insert(r,{id=${id},loaded=s.IsLoaded,length=s.TimeLength}) end;`).join(" ")} return game:GetService("HttpService"):JSONEncode(r)`,
        "Play",
      );
      const rawMeasurements = out?.measurements ?? out;
      let measurements: any[];
      if (Array.isArray(rawMeasurements)) measurements = rawMeasurements;
      else if (rawMeasurements && typeof rawMeasurements === "object") {
        const keys = Object.keys(rawMeasurements);
        if (keys.some((key) => !/^[1-9]\d*$/.test(key)))
          throw new Error("Studio returned invalid measurement keys");
        const indexes = keys.map(Number).sort((a, b) => a - b);
        if (indexes.some((index, i) => index !== i + 1))
          throw new Error("Studio returned non-contiguous measurements");
        measurements = indexes.map((index) => rawMeasurements[String(index)]);
      } else throw new Error("Studio returned invalid measurements");
      if (
        measurements.length !== created.length ||
        measurements.some(
          (item, index) =>
            !item ||
            item.id !== created![index] ||
            typeof item.loaded !== "boolean" ||
            typeof item.length !== "number" ||
            !Number.isFinite(item.length),
        )
      )
        throw new Error("Studio returned invalid measurement values");
      return meta(action, { measurements });
    }
    if (!created?.length) throw new Error("No host-created probe is active");
    const out = await call(
      `local S=game:GetService("SoundService"); local f=S:FindFirstChild(${JSON.stringify(folder)}); if f then if f:GetAttribute("TaskId")~=${JSON.stringify(context.taskId)} or f:GetAttribute("Attempt")~=${context.attempt} then error("ownership mismatch") end; f:Destroy() end; local remain=S:FindFirstChild(${JSON.stringify(folder)}); return {removed=f~=nil,remaining=remain~=nil}`,
      "Play",
    );
    if (
      typeof out?.removed !== "boolean" ||
      typeof out?.remaining !== "boolean"
    )
      throw new Error("Studio returned invalid cleanup confirmation");
    created = null;
    return meta(action, {
      removed: out.removed,
      remaining: out.remaining ? [folder] : [],
    });
  }
  async function validationControl(args: any) {
    const action = args?.action;
    if (!["before", "after", "mobile", "default"].includes(action))
      throw new Error("Invalid action");
    validateShape(action, args, false);
    if (action === "mobile" || action === "default") {
      const code =
        action === "default"
          ? `local s=game:GetService("StudioDeviceSimulatorService"); s:StopSimulationAsync(); return {device=s:GetDeviceAsync()}`
          : `local s=game:GetService("StudioDeviceSimulatorService"); for _,id in s:GetDeviceListAsync() do local i=s:GetDeviceInfoAsync(id); if string.find(string.lower(i.Name),"iphone",1,true) then s:SetDeviceAsync(id); s:SetOrientationAsync(Enum.ScreenOrientation.LandscapeLeft); task.wait(.2); return {device=i.Name} end end; error("iPhone simulator unavailable")`;
      const out = await call(code, "Edit");
      return meta(action, out);
    }
    const rootsLua = `{${roots.map((name) => JSON.stringify(name)).join(",")}}`;
    const code = `local Http=game:GetService("HttpService")
local roots=${rootsLua}
local rows={}
local keys={"Name","Position","Orientation","Size","CFrame","Anchored","Transparency","Visible","Text","Image","BackgroundColor3","TextColor3","Source"}
for _,n in ipairs(roots) do
  local root=game:GetService(n)
  local all={root}
  for _,v in ipairs(root:GetDescendants()) do table.insert(all,v) end
  for _,v in ipairs(all) do
    if not v:IsA("Camera") then
    local x={path=v:GetFullName(),class=v.ClassName}
    for _,k in ipairs(keys) do
      local ok,val=pcall(function() return v[k] end)
      if ok then
        if k=="Source" then x.Source=type(val)=="string" and val or "opaque"
        else
          local t=typeof(val)
          if t=="Vector2" or t=="Vector3" or t=="UDim2" or t=="Color3" or t=="CFrame" then x[k]=tostring(val)
          elseif t=="string" or t=="number" or t=="boolean" then x[k]=val end
        end
      end
    end
    local fields={}
    for _,k in ipairs(keys) do if x[k]~=nil then local v=Http:JSONEncode(x[k]); table.insert(fields,#k..":"..k..#v..":"..v) end end
    table.insert(rows,#x.path..":"..x.path..#x.class..":"..x.class..table.concat(fields))
    end
  end
end
table.sort(rows)
local bufferValue=buffer.fromstring(table.concat(rows,string.char(10)))
local digest=game:GetService("EncodingService"):ComputeBufferHash(bufferValue,Enum.HashAlgorithm.Sha256)
local hex={}
for i=0,buffer.len(digest)-1 do hex[#hex+1]=string.format("%02x",buffer.readu8(digest,i)) end
return {algorithm="sha256",digest=table.concat(hex),count=#rows}`;
    const out = await call(code, "Edit");
    const value = typeof out === "string" ? JSON.parse(out) : out;
    if (
      value?.algorithm !== "sha256" ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      typeof value.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.digest)
    )
      throw new Error("Studio returned invalid compact scene fingerprint");
    const current = { hash: value.digest, count: value.count };
    if (action === "before") {
      fingerprint = current;
      return meta(action, { fingerprint: current.hash, count: current.count });
    }
    const scenePreserved =
      !!fingerprint &&
      fingerprint.hash === current.hash &&
      fingerprint.count === current.count;
    return meta(action, {
      fingerprint: current.hash,
      count: current.count,
      scenePreserved,
    });
  }
  return { probeSfx, validationControl };
}
