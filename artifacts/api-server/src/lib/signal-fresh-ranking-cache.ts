import { createHash } from "node:crypto";
import type { CatalogResume } from "./signal-resume-catalog";
import type { MatchNeed, MatchEvaluation } from "./signal-matching";
import {MATCH_ALGORITHM_VERSION} from './signal-matching';
import type { SignalPoolScope } from "./signal-pool-scope";
import { resumeAssessmentMillis, isReadonlyResumeProjection } from './signal-readonly-resume';
import type { Response } from 'express';
type BandMemo = { source:WeakRef<object>; json:string; from:number; until:number; lastNow:number; bytes:number };
function ageBands(candidates:CatalogResume[],now:Date) {
  const atNow=now.getTime();let from=-Infinity,until=Infinity;
  const values=candidates.map(row=>{
    const at=resumeAssessmentMillis(row);
    if(at===null||!Number.isFinite(at))return 3;
    const thirty=at+30*86400000,ninety=at+90*86400000,end=at+180*86400000;
    if(atNow<=thirty){until=Math.min(until,thirty+1);return 0;}
    if(atNow<=ninety){from=Math.max(from,thirty+1);until=Math.min(until,ninety+1);return 1;}
    if(atNow<end){from=Math.max(from,ninety+1);until=Math.min(until,end);return 2;}
    from=Math.max(from,end);return 3;
  });
  return {json:JSON.stringify(values),from,until};
}
function rankingKeyWithBands(need:MatchNeed,scope:SignalPoolScope,overrides:ReadonlyMap<number,number>,poolFingerprint:string,evidenceFingerprint:string,bands:string) {
  // Incremental encoding is byte-identical to the original whole tuple. It
  // skips visiting an already owned, unchanged 25,000-element band array.
  const prefix=JSON.stringify([MATCH_ALGORITHM_VERSION,need,scope,[...overrides].sort((a,b)=>a[0]-b[0]),poolFingerprint,evidenceFingerprint]);
  return createHash('sha256').update(prefix.slice(0,-1)).update(',').update(bands).update(']').digest('hex');
}
export function freshRankingKey(
  need: MatchNeed,
  scope: SignalPoolScope,
  overrides: ReadonlyMap<number, number>,
  poolFingerprint: string,
  evidenceFingerprint: string,
  candidates: CatalogResume[],
  now: Date,
) {
  return rankingKeyWithBands(need,scope,overrides,poolFingerprint,evidenceFingerprint,ageBands(candidates,now).json);
}
type Entry<T> = {
  candidate: T;
  evaluation: MatchEvaluation;
  alternatives: T[];
};
type Compact = {
  resumeId: number;
  evaluation: MatchEvaluation;
  alternatives: number[];
};
type Saved = {
  data:Compact[]; bytes:number; facetBytes:number;
  json?:string; body?:Buffer;
  byUser:Map<number,number>;
  source?:WeakRef<object>;
  locations?:{candidate:number;alternatives:number[]}[];
  indexBytes:number;
};
/** V8 strings use at most two bytes per UTF-16 code unit. UTF-8 byte length
 * times two overcounts Cyrillic and surrogate pairs; include string metadata. */
export function estimateRankingStringBytes(value: string) {
  return value.length * 2 + 64;
}
/** Pure computation memo; key comes from fresh full SQL whitelist and fresh
 * mutable assessment/correction reads on EVERY request. Stores compact pure
 * computation plus the explicit professional `/matches` JSON DTO. No mutable
 * Dates, contacts, photographs, action permissions or answer/oracles are stored. */
export class FreshRankingCache {
  private counts={hits:0,misses:0,stores:0,evictions:0,oversized:0,facetHits:0,facetMisses:0,facetStores:0,facetOversized:0,lastFacetEstimatedBytes:0,lastCombinedEstimatedBytes:0};
  private entries = new Map<string, Saved>();
  private bandMemo?:BandMemo;
  private currentKeys=new WeakMap<object,string>();
  constructor(
    private capacity = 2,
    private byteBudget = 48 * 1024 * 1024,
  ) {
    if(process.env.SIGNAL_LOAD_PROFILE_DIAGNOSTICS==='1') {
      const key=Symbol.for('signal.load.cacheDiagnostics');
      const global=globalThis as unknown as Record<symbol,{diagnostics:()=>unknown}[]>;
      (global[key]??=[]).push(this);
    }
  }
  private retainedBytes(){return [...this.entries.values()].reduce((sum,row)=>sum+row.bytes,0)+(this.bandMemo?.bytes??0);}
  private makeRoom(bytes:number,newEntry=true){while(this.entries.size&&((newEntry&&this.entries.size>=this.capacity)||this.retainedBytes()+bytes>this.byteBudget)){this.entries.delete(this.entries.keys().next().value!);this.counts.evictions++;}}
  diagnostics() {return {name:'ranking_and_professional_json',...this.counts,entries:this.entries.size,bandEstimatedBytes:this.bandMemo?.bytes??0,entrySizes:[...this.entries.values()].map(row=>({estimatedBytes:row.bytes,compactEstimatedBytes:row.bytes-row.facetBytes-row.indexBytes,indexEstimatedBytes:row.indexBytes,jsonEstimatedBytes:row.facetBytes,hasJson:row.json!==undefined||row.body!==undefined,utf8Facet:row.body!==undefined,people:row.data.length})),retainedEstimatedBytes:this.retainedBytes(),budgetBytes:this.byteBudget};}
  /** A single weak source and its encoded bands share the SAME byte budget.
   * Only factory-owned immutable rows qualify. Every exact boundary and a
   * backwards clock are recomputed; no Date or caller-owned array is retained. */
  key(need:MatchNeed,scope:SignalPoolScope,overrides:ReadonlyMap<number,number>,pool:string,evidence:string,candidates:CatalogResume[],now:Date) {
    const millis=now.getTime(),memo=this.bandMemo;
    if(memo&&memo.source.deref()===candidates&&Number.isFinite(millis)&&millis>=memo.lastNow&&millis>=memo.from&&millis<memo.until){memo.lastNow=millis;return rankingKeyWithBands(need,scope,overrides,pool,evidence,memo.json);}
    const bands=ageBands(candidates,now),bytes=estimateRankingStringBytes(bands.json)+128;
    if(Number.isFinite(millis)&&Object.isFrozen(candidates)&&candidates.every(isReadonlyResumeProjection)&&bytes<=this.byteBudget){
      this.bandMemo=undefined;this.makeRoom(bytes,false);this.bandMemo={source:new WeakRef(candidates),...bands,lastNow:millis,bytes};
    }
    return rankingKeyWithBands(need,scope,overrides,pool,evidence,bands.json);
  }
  read<T extends CatalogResume>(
    key: string,
    candidates: T[],
    compute: () => Entry<T>[],
  ): Entry<T>[] {
    const hit=this.readIfPresent(key,candidates);
    if(hit)return hit;
    this.counts.misses++;
    const result = compute(),
      data = result.map((row) => ({
        resumeId: row.candidate.resumeId,
        evaluation: row.evaluation,
        alternatives: row.alternatives.map((candidate) => candidate.resumeId),
      }));
    const byUser=new Map(result.map((row,index)=>[row.candidate.userId,index]));
    const owned=Object.isFrozen(candidates)&&candidates.every(isReadonlyResumeProjection);
    const offsets=owned?new Map(candidates.map((row,index)=>[row.resumeId,index])):undefined;
    const locations=offsets&&data.every(row=>offsets.has(row.resumeId)&&row.alternatives.every(id=>offsets.has(id)))?data.map(row=>({candidate:offsets.get(row.resumeId)!,alternatives:row.alternatives.map(id=>offsets.get(id)!)})):undefined;
    const indexBytes=byUser.size*128+(locations?locations.reduce((sum,row)=>sum+80+8*(1+row.alternatives.length),0)+32:0);
    const bytes = estimateRankingStringBytes(JSON.stringify(data)) + data.length * 256+indexBytes;
    if (bytes+(this.bandMemo?.bytes??0) <= this.byteBudget) {
      const freeze = (value: unknown): void => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          for (const child of Object.values(value)) freeze(child);
          Object.freeze(value);
        }
      };
      freeze(data);
      freeze(locations);
      this.entries.delete(key);
      this.makeRoom(bytes);
      this.entries.set(key, { data, bytes,facetBytes:0,indexBytes,byUser,...(locations?{source:new WeakRef(candidates),locations}:{}) });
      this.counts.stores++;
    } else this.counts.oversized++;
    this.currentKeys.set(result,key);return result;
  }
  readIfPresent<T extends CatalogResume>(key:string,candidates:T[]):Entry<T>[]|undefined {
    const saved=this.entries.get(key);if(!saved)return undefined;
    const attach=this.attachment(saved,candidates);if(attach) {
      this.counts.hits++;
      this.entries.delete(key);
      this.entries.set(key, saved);
      const result=saved.data.map((row,index)=>attach(row,index));
      this.currentKeys.set(result,key);return result;
    }
    return undefined;
  }
  private attachment<T extends CatalogResume>(saved:Saved,candidates:T[]) {
    if(saved.source?.deref()===candidates&&saved.locations){
      const locations=saved.locations;
      return (row:Compact,index:number):Entry<T>=>({candidate:candidates[locations[index]!.candidate]!,evaluation:row.evaluation,alternatives:locations[index]!.alternatives.map(offset=>candidates[offset]!)});
    }
    const byId=new Map(candidates.map(row=>[row.resumeId,row]));
    if(!saved.data.every(row=>byId.has(row.resumeId)&&row.alternatives.every(id=>byId.has(id))))return undefined;
    return (row:Compact):Entry<T>=>({candidate:byId.get(row.resumeId)!,evaluation:row.evaluation,alternatives:row.alternatives.map(id=>byId.get(id)!)});
  }
  /** Exact default winner only; caller obtained the entire current SQL/evidence
   * key first. Alternatives, absent owners and arbitrary keys cannot borrow it.
   * Fallback retains the original full override calculation and pool ordinal. */
  readDefaultEntry<T extends CatalogResume>(key:string,candidates:T[],userId:number,resumeId:number):Entry<T>|undefined {
    const saved=this.entries.get(key),index=saved?.byUser.get(userId);
    if(!saved||index===undefined||saved.data[index]?.resumeId!==resumeId)return undefined;
    const attach=this.attachment(saved,candidates);if(!attach)return undefined;
    const result=attach(saved.data[index]!,index);if(result.candidate.userId!==userId)return undefined;
    this.entries.delete(key);this.entries.set(key,saved);this.counts.hits++;return result;
  }
  /** Overrides equal to every actual default selected résumé change no ranking
   * fact or DTO. Others retain their distinct full input key and calculation. */
  readEquivalentDefault<T extends CatalogResume>(key:string,candidates:T[],overrides:ReadonlyMap<number,number>) {
    const saved=this.entries.get(key);if(!saved)return undefined;
    if(saved.source?.deref()!==candidates){
      // The injected-reader/mutable-array contract reattaches current owners;
      // only the exact immutable source can use its stored owner index.
      const current=this.readIfPresent(key,candidates);if(!current)return undefined;
      const chosen=new Map(current.map(row=>[row.candidate.userId,row.candidate.resumeId]));
      return [...overrides].every(([userId,resumeId])=>chosen.get(userId)===resumeId)?current:undefined;
    }
    if(![...overrides].every(([userId,resumeId])=>{const index=saved.byUser.get(userId);return index!==undefined&&saved.data[index]?.resumeId===resumeId;}))return undefined;
    return this.readIfPresent(key,candidates);
  }
  /** The exact `/matches` professional DTO has no company/need ID, contacts,
   * photographs or action permissions. Session and owned-need ACLs have already
   * been checked on THIS request; the key commits all current material inputs.
   * Presentation storage shares the SAME two-entry/budget bound with ranking. */
  serialize(entries:object,build:()=>string):string {
    const key=this.currentKeys.get(entries),saved=key?this.entries.get(key):undefined;
    if(saved?.json!==undefined) {this.counts.facetHits++;return saved.json;}
    if(saved?.body!==undefined){this.counts.facetHits++;return saved.body.toString('utf8');}
    this.counts.facetMisses++;
    const json=build();
    if(saved&&key) {
      const bytes=estimateRankingStringBytes(json);
      this.counts.lastFacetEstimatedBytes=bytes;this.counts.lastCombinedEstimatedBytes=saved.bytes+bytes;
      if(saved.bytes+bytes+(this.bandMemo?.bytes??0)<=this.byteBudget) {
        this.entries.delete(key);
        this.makeRoom(saved.bytes+bytes);
        saved.json=json;saved.facetBytes=bytes;saved.bytes+=bytes;this.entries.set(key,saved);
        this.counts.facetStores++;
      } else this.counts.facetOversized++;
    }
    return json;
  }
  /** Private UTF8 transport facet: the mutable Buffer never leaves this class.
   * Express's ordinary send consumes it; no body/permission is exposed
   * through a getter. Replaces any string facet instead of keeping two copies. */
  respondJson(entries:object,build:()=>string,response:Pick<Response,'setHeader'|'send'>):void {
    const key=this.currentKeys.get(entries),saved=key?this.entries.get(key):undefined;
    let body=saved?.body;
    if(body)this.counts.facetHits++;
    else {
      this.counts.facetMisses++;
      body=Buffer.from(saved?.json??build(),'utf8');const bytes=body.byteLength+64;
      if(saved&&key){
        const total=saved.bytes-saved.facetBytes+bytes;
        this.counts.lastFacetEstimatedBytes=bytes;this.counts.lastCombinedEstimatedBytes=total;
        if(total+(this.bandMemo?.bytes??0)<=this.byteBudget){
          this.entries.delete(key);this.makeRoom(total);
          saved.json=undefined;saved.body=body;saved.facetBytes=bytes;saved.bytes=total;this.entries.set(key,saved);this.counts.facetStores++;
        }else this.counts.facetOversized++;
      }
    }
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.send(body); // Preserve Express Content-Length, ETag, HEAD and freshness handling.
  }
}
