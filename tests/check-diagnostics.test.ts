import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDiagnostics } from "../server/check-diagnostics.js";
test("repair feedback retains errors after a large layout report and both real devices", () => {
  const desktop = {viewport:[1365,768],screens:{hud:{rectangles:Array.from({length:2000},(_,i)=>({x:i,y:i}))}},errors:["requested viewport comparison too strict"]};
  const mobile = {viewport:[389,823],screens:{hud:{rectangles:desktop.screens.hud.rectangles}},errors:["translated label clipped"]};
  const evidence = JSON.stringify(desktop) + "; mobile: " + JSON.stringify(mobile);
  assert.ok(evidence.length > 30000);
  const compact = checkDiagnostics({id:"localization",status:"blocked",evidence});
  assert.equal(compact.status,"blocked");
  assert.match(JSON.stringify(compact),/requested viewport comparison too strict/);
  assert.match(JSON.stringify(compact),/translated label clipped/);
  assert.ok(JSON.stringify(compact).length < 1500);
});
