import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync(new URL('../plugin/Automation.plugin.luau',import.meta.url),'utf8');
const escaped=src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
writeFileSync(new URL('../plugin/Automation.rbxmx',import.meta.url),`<roblox version="4"><External>null</External><External>nil</External><Item class="Script" referent="RBX0"><Properties><string name="Name">Automation</string><ProtectedString name="Source">${escaped}</ProtectedString></Properties></Item></roblox>`);
