// @vitest-environment happy-dom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {configureTestClient} from './client-fixture'
import {configureClientIO} from '../src/lib/client-io'
import {createBrowserClientCapabilities} from '../src/platform/client'
import {createPasskey,passkeyRegister,passkeyLogin} from '../src/lib/api'
import {decodeSource,importCodeFromImageWeb} from '../src/lib/scan-web'
import {renderQrToCanvas} from '../src/lib/qr'
let platform: ReturnType<typeof configureTestClient>
beforeEach(()=>{platform=configureTestClient()})
afterEach(()=>vi.unstubAllGlobals())
const bytes=(n:number)=>new Uint8Array([n]).buffer
const credential={id:'key',rawId:bytes(1),type:'public-key',response:{clientDataJSON:bytes(2),attestationObject:bytes(3)},getClientExtensionResults:()=>({})}

describe('passkey registration and creation',()=>{
 it('converts a copied creation challenge and serializes attestation without changing the caller',async()=>{
  const create=vi.fn(async()=>credential as unknown as Credential)
  configureClientIO(platform,{...createBrowserClientCapabilities(platform),credentials:{create,get:async()=>null}})
  const options={challenge:'AQ',user:{id:'Ag',name:'Synthetic'},excludeCredentials:[{id:'Aw',type:'public-key'}]}
  const before=JSON.stringify(options)
  const result=await createPasskey(options)
  expect(JSON.stringify(options)).toBe(before)
  const call=create.mock.calls as unknown as [CredentialCreationOptions][]
  expect(new Uint8Array(call[0]![0].publicKey!.challenge as ArrayBuffer)).toEqual(new Uint8Array([1]))
  expect(new Uint8Array(call[0]![0].publicKey!.user.id as ArrayBuffer)).toEqual(new Uint8Array([2]))
  expect(result).toMatchObject({id:'key',rawId:'AQ',response:{clientDataJSON:'Ag',attestationObject:'Aw',transports:['internal']}})
 })
 it('registers and logs in through Platform, returning the contract user',async()=>{
  const caps=createBrowserClientCapabilities(platform)
  configureClientIO(platform,{...caps,credentials:{create:async()=>credential as unknown as Credential,get:async()=>({...credential,response:{clientDataJSON:bytes(2),authenticatorData:bytes(3),signature:bytes(4),userHandle:null}}) as unknown as Credential}})
  const user={id:'u',name:'Synthetic',admin:false}
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/options')?{cid:'challenge',options:{challenge:'AQ',user:{id:'Ag'},excludeCredentials:[],allowCredentials:[]}}:{user})))
  vi.stubGlobal('fetch',fetch)
  expect(await passkeyRegister('Synthetic')).toEqual(user)
  expect(await passkeyLogin()).toEqual(user)
  const calls=fetch.mock.calls as unknown as [string,RequestInit][]
  expect(JSON.parse(String(calls[0]![1].body))).toEqual({name:'Synthetic',code:''})
  expect(JSON.parse(String(calls[3]![1].body))).toMatchObject({cid:'challenge',credential:{response:{signature:'BA',userHandle:null}}})
 })
})

describe('clipboard capability',()=>{
 it('uses the modern API then the selection fallback, cleaning up even when copying throws',async()=>{
  const caps=createBrowserClientCapabilities(platform), writeText=vi.fn(async()=>{})
  const original=Object.getOwnPropertyDescriptor(navigator,'clipboard')
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
  try {
   expect(await caps.copyText('first')).toBe(true);expect(writeText).toHaveBeenCalledWith('first')
   writeText.mockRejectedValue(new Error('denied'))
   const command=vi.fn(()=>true)
   Object.defineProperty(document,'execCommand',{configurable:true,value:command})
   expect(await caps.copyText('second')).toBe(true);expect(command).toHaveBeenCalledWith('copy')
   expect(document.querySelector('textarea')).toBeNull()
   command.mockImplementation(()=>{throw new Error('unsupported')})
   expect(await caps.copyText('third')).toBe(false);expect(document.querySelector('textarea')).toBeNull()
  } finally {if(original)Object.defineProperty(navigator,'clipboard',original);else delete (navigator as any).clipboard; delete (document as any).execCommand}
 })
})

describe('web scanning capability',()=>{
 it('bounds source raster size, falls through a refused native detector and closes picked bitmaps',async()=>{
  const drawImage=vi.fn(),canvas:any={width:0,height:0,getContext:()=>({drawImage,getImageData:()=>({data:new Uint8ClampedArray(64*64*4).fill(255),width:64,height:64})})}
  const detect=vi.fn(async()=>[{rawValue:'CODE',format:'qr_code'}])
  const close=vi.fn(),bitmap:any={width:1600,height:800,close}
  configureClientIO(platform,{...createBrowserClientCapabilities(platform),canvas:()=>canvas,barcodeDetector:()=>({detect}),image:async()=>bitmap})
  expect(await decodeSource(bitmap)).toEqual({value:'CODE',fmt:'qrcode'})
  expect(canvas.width).toBe(800);expect(canvas.height).toBe(400)
  expect(drawImage).toHaveBeenCalledWith(bitmap,0,0,800,400)
  detect.mockRejectedValue(new Error('unavailable'))
  expect(await importCodeFromImageWeb(new Blob(['image']))).toBeNull()
  expect(close).toHaveBeenCalledOnce()
  expect(await importCodeFromImageWeb(null)).toBeNull()
  expect(await decodeSource({width:0,height:0} as any)).toBeNull()
 })
 it('renders actual QR pixels onto a caller-supplied canvas',async()=>{
  const putImageData=vi.fn(),canvas:any={width:0,height:0,getContext:()=>({createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData})}
  const size=await renderQrToCanvas(canvas,'BROWSER-SYNTHETIC')
  expect(size).toBeGreaterThan(0);expect(canvas.width).toBe(size+4)
  expect(putImageData).toHaveBeenCalled()
  expect(await renderQrToCanvas(null,'')).toBe(0)
 })
})
