import { describe,expect,it } from 'vitest';
import { isRuntimeMessage } from '../src/protocol.js';
describe('message validation',()=>{
  it('accepts expected ready messages',()=>expect(isRuntimeMessage({channel:'pfx-frontlab',type:'ready',token:'abc',runId:1})).toBe(true));
  it('rejects malformed diagnostic payloads',()=>expect(isRuntimeMessage({channel:'pfx-frontlab',type:'diagnostic',token:'abc',runId:1,diagnostic:{level:'error',kind:'runtime',message:10}})).toBe(false));
  it('rejects unrelated messages',()=>expect(isRuntimeMessage({type:'ready'})).toBe(false));
});
