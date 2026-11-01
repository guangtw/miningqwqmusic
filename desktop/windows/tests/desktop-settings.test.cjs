const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const script = readFileSync(path.join(__dirname, '../src/MiningQwQMusic/Assets/desktop-settings.js'), 'utf8');
class Node {
  constructor(tag='div') { this.tag=tag; this.children=[]; this.dataset={}; this.attrs={}; this.events={}; this.textContent=''; this.className=''; this.parentElement=null; this.classList={toggle:(name,on)=>this.className=on?name:''}; }
  append(...nodes) { for(const node of nodes) { node.remove(); node.parentElement=this; this.children.push(node); } }
  remove() { if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(node=>node!==this); this.parentElement=null; }
  setAttribute(key,value) {this.attrs[key]=value;}
  getAttribute(key) {return this.attrs[key];}
  addEventListener(key,fn) {this.events[key]=fn;}
}
function fixture({native=true,origin='https://echo.miningqwq.cn'}={}) {
  const events={}, messages=[], frames=[], form=new Node();
  form.append(new Node()); // Existing React-owned settings row.
  const window={}; window.top=window;
  if(native) window.chrome={webview:{postMessage:value=>messages.push(value),addEventListener:(type,fn)=>events['host-'+type]=fn}};
  const location={origin,hash:'#/settings'};
  const context={window,location,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},addEventListener:(type,fn)=>events[type]=fn,
    document:{body:{},createElement:tag=>new Node(tag),querySelector:()=>form}};
  vm.runInNewContext(script,context);
  const flush=()=>{for(let i=0;frames.length;i++){if(i>20)throw Error('Render loop');frames.shift()();}};
  return {events,messages,form,location,flush};
}
test('ordinary browser and foreign origin receive no injected settings',()=>{
  assert.equal(Object.keys(fixture({native:false}).events).length,0);
  assert.equal(Object.keys(fixture({origin:'https://example.test'}).events).length,0);
});
test('settings require native acknowledgement and update without duplicate rows',()=>{
  const f=fixture(); f.events.DOMContentLoaded(); f.flush();
  assert.equal(f.form.children.length,1);
  assert.equal(f.messages[0].type,'desktop-ready');
  f.events['host-message']({data:{type:'desktop-settings',protocol:1,closeToTray:true,fullScreen:false}}); f.flush();
  assert.equal(f.form.children.length,4);
  const group=f.form.children[1].children[1].children[0];
  assert.equal(group.children[0].getAttribute('aria-checked'),'true');
  group.children[1].events.click();
  assert.equal(f.messages.at(-1).action,'closeToTray');
  assert.equal(f.messages.at(-1).value,false);
  f.events['host-message']({data:{type:'desktop-settings',protocol:1,closeToTray:false,fullScreen:false}}); f.flush();
  assert.equal(f.form.children.length,4);
  assert.equal(group.children[1].getAttribute('aria-checked'),'true');
  f.location.hash='#/account';f.events.hashchange();f.flush();
  assert.equal(f.form.children.length,1);
  f.location.hash='#/account?tab=settings';f.events.hashchange();f.flush();
  assert.equal(f.form.children.length,4);
});
