local ReplicatedStorage = game:GetService("ReplicatedStorage")
local KSP = game:GetService("KeyframeSequenceProvider")
local TREE = {{"LowerTorso","HumanoidRootPart"},{"UpperTorso","LowerTorso"},{"Head","UpperTorso"},{"LeftUpperArm","UpperTorso"},{"LeftLowerArm","LeftUpperArm"},{"LeftHand","LeftLowerArm"},{"RightUpperArm","UpperTorso"},{"RightLowerArm","RightUpperArm"},{"RightHand","RightLowerArm"},{"LeftUpperLeg","LowerTorso"},{"LeftLowerLeg","LeftUpperLeg"},{"LeftFoot","LeftLowerLeg"},{"RightUpperLeg","LowerTorso"},{"RightLowerLeg","RightUpperLeg"},{"RightFoot","RightLowerLeg"}}
local PARENT = {}
for _, pair in ipairs(TREE) do PARENT[pair[1]] = pair[2] end
local function build(name, priority, loopAnim, KFS)
	local seq = Instance.new("KeyframeSequence")
	seq.Name, seq.Priority, seq.Loop = name, Enum.AnimationPriority[priority], loopAnim
	for _, k in ipairs(KFS) do
		local kf = Instance.new("Keyframe")
		kf.Name, kf.Time = "KF" .. tostring(k.t), k.t
		local poses = {}
		local root = Instance.new("Pose")
		root.Name, root.CFrame = "HumanoidRootPart", CFrame.new()
		poses.HumanoidRootPart = root
		for _, pair in ipairs(TREE) do
			local p = Instance.new("Pose")
			p.Name = pair[1]
			if not k.poses[pair[1]] then p.Weight = 0 end
			local d, cf = k.poses[pair[1]], CFrame.new()
			if d then
				if d.r then
					cf = CFrame.Angles(0,0,math.rad(d.r[3])) * CFrame.Angles(0,math.rad(d.r[2]),0) * CFrame.Angles(math.rad(d.r[1]),0,0)
				end
				if d.p then
					cf = CFrame.new(d.p[1], d.p[2], d.p[3]) * cf
				end
			end
			p.CFrame = cf
			p.EasingStyle = Enum.PoseEasingStyle[k.s]
			p.EasingDirection = Enum.PoseEasingDirection[k.d]
			poses[pair[1]] = p
		end
		-- A joint the clip never keys gets NO Pose. The old builder wrote the full
		-- tree at identity, so an upper-body clip at Action priority pinned both legs
		-- straight and froze the default walk. Keep only keyed joints plus the
		-- ancestors that hold them (those as Weight-0 containers).
		local keep = {}
		for _, pair in ipairs(TREE) do
			if k.poses[pair[1]] then
				local j = pair[1]
				while j and j ~= "HumanoidRootPart" do keep[j] = true j = PARENT[j] end
			end
		end
		for _, pair in ipairs(TREE) do
			if keep[pair[1]] then poses[pair[1]].Parent = poses[pair[2]] else poses[pair[1]]:Destroy() end
		end
		root.Parent = kf
		if k.m then
			for _, mname in ipairs(k.m) do
				local mk = Instance.new("KeyframeMarker")
				mk.Name, mk.Value = mname, ""
				kf:AddMarker(mk)
			end
		end
		kf.Parent = seq
	end
	return seq
end
local folder = ReplicatedStorage
for _, seg in ipairs({"__SyphoMotionDiagnostic_Anims"}) do
	local nxt = folder:FindFirstChild(seg)
	if not nxt then
		nxt = Instance.new("Folder")
		nxt.Name = seg
		nxt.Parent = folder
	end
	folder = nxt
end
local report = {}
local built = {}
do local s = build("Wave","Action",true,{{t=0,s="Cubic",d="InOut",poses={["Head"]={r={0,10,0}},["LeftFoot"]={r={4,0,0}},["LeftLowerArm"]={r={12,0,0}},["LeftLowerLeg"]={r={-6,0,0}},["LeftUpperArm"]={r={4,0,10}},["LeftUpperLeg"]={r={2,0,-6}},["LowerTorso"]={r={0,-6,0},p={0,0,0}},["RightFoot"]={r={6,0,0}},["RightLowerArm"]={r={0,0,84}},["RightLowerLeg"]={r={-4,0,0}},["RightUpperArm"]={r={25,0,82}},["RightUpperLeg"]={r={-2,0,6}},["UpperTorso"]={r={-2,-8,0}}}},{t=0.3,s="Cubic",d="InOut",poses={["Head"]={r={0,8,0}},["LeftFoot"]={r={4,0,0}},["LeftLowerArm"]={r={12,0,0}},["LeftLowerLeg"]={r={-6,0,0}},["LeftUpperArm"]={r={4,0,10}},["LeftUpperLeg"]={r={2,0,-6}},["LowerTorso"]={r={0,-4,0},p={0,-0.03,0}},["RightFoot"]={r={6,0,0}},["RightLowerArm"]={r={0,0,112}},["RightLowerLeg"]={r={-4,0,0}},["RightUpperArm"]={r={25,0,86}},["RightUpperLeg"]={r={-2,0,6}},["UpperTorso"]={r={-2,-5,0}}}},{t=0.6,s="Cubic",d="InOut",poses={["Head"]={r={0,10,0}},["LeftFoot"]={r={4,0,0}},["LeftLowerArm"]={r={12,0,0}},["LeftLowerLeg"]={r={-6,0,0}},["LeftUpperArm"]={r={4,0,10}},["LeftUpperLeg"]={r={2,0,-6}},["LowerTorso"]={r={0,-6,0},p={0,0,0}},["RightFoot"]={r={6,0,0}},["RightLowerArm"]={r={0,0,84}},["RightLowerLeg"]={r={-4,0,0}},["RightUpperArm"]={r={25,0,82}},["RightUpperLeg"]={r={-2,0,6}},["UpperTorso"]={r={-2,-8,0}}}},{t=0.9,s="Cubic",d="InOut",poses={["Head"]={r={0,8,0}},["LeftFoot"]={r={4,0,0}},["LeftLowerArm"]={r={12,0,0}},["LeftLowerLeg"]={r={-6,0,0}},["LeftUpperArm"]={r={4,0,10}},["LeftUpperLeg"]={r={2,0,-6}},["LowerTorso"]={r={0,-4,0},p={0,-0.03,0}},["RightFoot"]={r={6,0,0}},["RightLowerArm"]={r={0,0,112}},["RightLowerLeg"]={r={-4,0,0}},["RightUpperArm"]={r={25,0,86}},["RightUpperLeg"]={r={-2,0,6}},["UpperTorso"]={r={-2,-5,0}}}},{t=1.2,s="Cubic",d="InOut",poses={["Head"]={r={0,10,0}},["LeftFoot"]={r={4,0,0}},["LeftLowerArm"]={r={12,0,0}},["LeftLowerLeg"]={r={-6,0,0}},["LeftUpperArm"]={r={4,0,10}},["LeftUpperLeg"]={r={2,0,-6}},["LowerTorso"]={r={0,-6,0},p={0,0,0}},["RightFoot"]={r={6,0,0}},["RightLowerArm"]={r={0,0,84}},["RightLowerLeg"]={r={-4,0,0}},["RightUpperArm"]={r={25,0,82}},["RightUpperLeg"]={r={-2,0,6}},["UpperTorso"]={r={-2,-8,0}}}}}) local old = folder:FindFirstChild(s.Name) while old do old:Destroy() old = folder:FindFirstChild(s.Name) end s.Parent = folder table.insert(built, s) end
for _, seq in ipairs(built) do
	local n, len, markers, posed, holders = 0, 0, {}, {}, {}
	for _, kf in ipairs(seq:GetChildren()) do
		if kf:IsA("Keyframe") then
			n += 1
			if kf.Time > len then len = kf.Time end
			for _, mk in ipairs(kf:GetMarkers()) do table.insert(markers, ("%s@%.3f"):format(mk.Name, kf.Time)) end
			for _, p in ipairs(kf:GetDescendants()) do
				if p:IsA("Pose") and p.Name ~= "HumanoidRootPart" then  -- root carries no motor
					if p.Weight > 0 then posed[p.Name] = true else holders[p.Name] = true end
				end
			end
		end
	end
	local pl, hl = {}, {}
	for k in pairs(posed) do table.insert(pl, k) end
	for k in pairs(holders) do if not posed[k] then table.insert(hl, k) end end
	table.sort(pl) table.sort(hl)
	table.insert(report, ("%s: %d kf, length %.3fs, priority %s, loop %s, markers [%s], posed [%s], weight-0 holders [%s], parent %s")
		:format(seq.Name, n, len, seq.Priority.Name, tostring(seq.Loop), table.concat(markers, ","),
			table.concat(pl, ","), table.concat(hl, ","), seq.Parent:GetFullName()))
end
return table.concat(report, "\n")
