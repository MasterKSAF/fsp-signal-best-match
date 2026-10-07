import { createHash } from "node:crypto";
import type { CatalogResume } from "./signal-resume-catalog";
import type { MatchNeed, MatchEvaluation } from "./signal-matching";
import {MATCH_ALGORITHM_VERSION} from './signal-matching';
import type { SignalPoolScope } from "./signal-pool-scope";
import { resumeAssessmentMillis } from './signal-readonly-resume';
export function freshRankingKey(
  need: MatchNeed,
  scope: SignalPoolScope,
  overrides: ReadonlyMap<number, number>,
  poolFingerprint: string,
  evidenceFingerprint: string,
  candidates: CatalogResume[],
  now: Date,
) {
  const bands = candidates.map((row) => {
    const at = resumeAssessmentMillis(row);
    if (at === null || !Number.isFinite(at)) return 3;
    const days = Math.max(0, (now.getTime() - at) / 86400000);
    return days <= 30 ? 0 : days <= 90 ? 1 : days < 180 ? 2 : 3;
  });
  return createHash("sha256")
    .update(
      JSON.stringify([
        MATCH_ALGORITHM_VERSION,
        need,
        scope,
        [...overrides].sort((a, b) => a[0] - b[0]),
        poolFingerprint,
        evidenceFingerprint,
        bands,
      ]),
    )
    .digest("hex");
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
  private entries = new Map<string, { data: Compact[]; bytes: number; json?:string }>();
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
  diagnostics() {return {name:'ranking_and_professional_json',...this.counts,entries:this.entries.size,entrySizes:[...this.entries.values()].map(row=>({estimatedBytes:row.bytes,compactEstimatedBytes:row.bytes-(row.json!==undefined?estimateRankingStringBytes(row.json):0),jsonEstimatedBytes:row.json!==undefined?estimateRankingStringBytes(row.json):0,hasJson:row.json!==undefined,people:row.data.length})),retainedEstimatedBytes:[...this.entries.values()].reduce((sum,row)=>sum+row.bytes,0),budgetBytes:this.byteBudget};}
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
    const bytes =
      estimateRankingStringBytes(JSON.stringify(data)) + data.length * 256;
    if (bytes <= this.byteBudget) {
      const freeze = (value: unknown): void => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          for (const child of Object.values(value)) freeze(child);
          Object.freeze(value);
        }
      };
      freeze(data);
      this.entries.delete(key);
      while (
        this.entries.size &&
        (this.entries.size >= this.capacity ||
          [...this.entries.values()].reduce((n, row) => n + row.bytes, 0) +
            bytes >
            this.byteBudget)
      ) {
        this.entries.delete(this.entries.keys().next().value!);this.counts.evictions++;
      }
      this.entries.set(key, { data, bytes });
      this.counts.stores++;
    } else this.counts.oversized++;
    this.currentKeys.set(result,key);return result;
  }
  readIfPresent<T extends CatalogResume>(key:string,candidates:T[]):Entry<T>[]|undefined {
    const saved = this.entries.get(key),
      byId = saved ? new Map(candidates.map((row) => [row.resumeId, row])) : undefined;
    if (
      saved &&
      saved.data.every(
        (row) =>
          byId!.has(row.resumeId) &&
          row.alternatives.every((id) => byId!.has(id)),
      )
    ) {
      this.counts.hits++;
      this.entries.delete(key);
      this.entries.set(key, saved);
      const result=saved.data.map((row) => ({
        candidate: byId!.get(row.resumeId)!,
        evaluation: row.evaluation,
        alternatives: row.alternatives.map((id) => byId!.get(id)!),
      }));
      this.currentKeys.set(result,key);return result;
    }
    return undefined;
  }
  /** Overrides equal to every actual default selected résumé change no ranking
   * fact or DTO. Others retain their distinct full input key and calculation. */
  readEquivalentDefault<T extends CatalogResume>(key:string,candidates:T[],overrides:ReadonlyMap<number,number>) {
    const saved=this.readIfPresent(key,candidates);
    if(!saved)return undefined;
    const chosen=new Map(saved.map(row=>[row.candidate.userId,row.candidate.resumeId]));
    return [...overrides].every(([userId,resumeId])=>chosen.get(userId)===resumeId)?saved:undefined;
  }
  /** The exact `/matches` professional DTO has no company/need ID, contacts,
   * photographs or action permissions. Session and owned-need ACLs have already
   * been checked on THIS request; the key commits all current material inputs.
   * Presentation storage shares the SAME two-entry/budget bound with ranking. */
  serialize(entries:object,build:()=>string):string {
    const key=this.currentKeys.get(entries),saved=key?this.entries.get(key):undefined;
    if(saved?.json!==undefined) {this.counts.facetHits++;return saved.json;}
    this.counts.facetMisses++;
    const json=build();
    if(saved&&key) {
      const bytes=estimateRankingStringBytes(json);
      this.counts.lastFacetEstimatedBytes=bytes;this.counts.lastCombinedEstimatedBytes=saved.bytes+bytes;
      if(saved.bytes+bytes<=this.byteBudget) {
        this.entries.delete(key);
        while(this.entries.size&&[...this.entries.values()].reduce((sum,row)=>sum+row.bytes,0)+saved.bytes+bytes>this.byteBudget) {
          this.entries.delete(this.entries.keys().next().value!);this.counts.evictions++;
        }
        saved.json=json;saved.bytes+=bytes;this.entries.set(key,saved);
        this.counts.facetStores++;
      } else this.counts.facetOversized++;
    }
    return json;
  }
}
