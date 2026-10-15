import { afterEach,beforeEach,expect,it,vi } from "vitest";
import type { ChangeEvent,ReactElement } from "react";
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0,create:vi.fn()}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useEffect:vi.fn(),useState:(initial:unknown)=> { const i=hooks.cursor++; if(!(i in hooks.values)) hooks.values[i]=initial; return [hooks.values[i],(value:unknown)=> {hooks.values[i]=value;}]; },useRef:(initial:unknown)=> {const i=hooks.cursor++;return hooks.values[i]??(hooks.values[i]={current:initial});}}));
vi.mock("tesseract.js",()=>({createWorker:hooks.create}));
import { CardScanner } from "@/app/children/[childId]/card-scanner";
type Props={children?:unknown;type?:string;onChange?:(event:ChangeEvent<HTMLInputElement>)=>Promise<void>;onClick?:()=>void};
function find(tree:unknown,test:(props:Props)=>boolean):ReactElement<Props>|undefined {
 if(Array.isArray(tree)) {for(const child of tree){const result=find(child,test);if(result)return result;}}
 else if(tree&&typeof tree==="object"&&"props" in tree){const node=tree as ReactElement<Props>;if(test(node.props))return node;return find(node.props.children,test);}
}
function text(tree:unknown):string {if(typeof tree==="string")return tree;if(Array.isArray(tree))return tree.map(text).join("");if(tree&&typeof tree==="object"&&"props" in tree)return text((tree as ReactElement<Props>).props.children);return "";}
beforeEach(()=> {hooks.values=[];hooks.cursor=0;vi.clearAllMocks();});
afterEach(()=>vi.useRealTimers());
it("canceling initialization releases the form and terminates a worker that resolves later",async()=> {
 let resolve!:(worker:{recognize:ReturnType<typeof vi.fn>;terminate:ReturnType<typeof vi.fn>})=>void;
 hooks.create.mockReturnValue(new Promise(r=> {resolve=r;}));
 const onRows=vi.fn();const busy=vi.fn();const render=()=> {hooks.cursor=0;return CardScanner({onRows,onScanningChange:busy});};
 const choose=find(render(),props=>props.type==="file")!.props.onChange!;
 const pending=choose({target:{files:[new File(["image"],"card.png",{type:"image/png"})],value:""}} as unknown as ChangeEvent<HTMLInputElement>);
 await vi.waitFor(()=>expect(hooks.create).toHaveBeenCalled());
 find(render(),props=>!!props.onClick&&text(props.children).includes("Cancel"))!.props.onClick!();
 await pending;expect(busy).toHaveBeenLastCalledWith(false);expect(onRows).not.toHaveBeenCalled();
 const worker={recognize:vi.fn(),terminate:vi.fn(async()=>undefined)};resolve(worker);
 await vi.waitFor(()=>expect(worker.terminate).toHaveBeenCalled());expect(worker.recognize).not.toHaveBeenCalled();
});
it("a stalled initialization reaches a bounded timeout and leaves manual entry available",async()=> {
 vi.useFakeTimers();hooks.create.mockReturnValue(new Promise(()=>undefined));const busy=vi.fn();const render=()=>{hooks.cursor=0;return CardScanner({onRows:vi.fn(),onScanningChange:busy});};
 const pending=find(render(),props=>props.type==="file")!.props.onChange!({target:{files:[new File(["image"],"card.png",{type:"image/png"})],value:""}} as unknown as ChangeEvent<HTMLInputElement>);
 await vi.advanceTimersByTimeAsync(90000);await pending;
 expect(text(render())).toContain("Scanning took too long");expect(busy).toHaveBeenLastCalledWith(false);
});
