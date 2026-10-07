/** Reuse only after the caller has read a complete SHA256 fingerprint of the
 * currently permitted SQL rows. No time-to-live or positive permission shortcut. */
export class FreshJsonPoolCache<T> {
  private counts={hits:0,misses:0,joins:0,mismatchReloads:0,stores:0,evictions:0,peakInflight:0,queuedReuses:0,peakSnapshotBuilders:0};
  private builderTail:Promise<void>|null=null;
  private snapshotBuilders=0;
  private waitingBuilders=0;
  private fingerprints = new WeakMap<readonly T[], string>();
  fingerprintFor(data: readonly T[]) {
    return this.fingerprints.get(data);
  }
  private entries = new Map<string, { data: readonly T[]; bytes: number }>();
  private inflight = new Map<string, Promise<readonly T[]>>();
  constructor(
    private capacity = 2,
    private byteBudget = 128 * 1024 * 1024,
    private diagnosticName = 'raw_pool',
    private rowOverheadBytes = 512,
  ) {
    // Only the manifest-owned standalone load API enables this private
    // inspector diagnostic. No endpoint or application DTO exposes it.
    if(process.env.SIGNAL_LOAD_PROFILE_DIAGNOSTICS==='1') {
      const key=Symbol.for('signal.load.cacheDiagnostics');
      const global=globalThis as unknown as Record<symbol,FreshJsonPoolCache<unknown>[]>;
      (global[key]??=[]).push(this as FreshJsonPoolCache<unknown>);
    }
  }
  diagnostics() { return {name:this.diagnosticName,...this.counts,entries:this.entries.size,inflight:this.inflight.size,snapshotBuilders:this.snapshotBuilders,waitingBuilders:this.waitingBuilders,retainedEstimatedBytes:[...this.entries.values()].reduce((sum,row)=>sum+row.bytes,0),budgetBytes:this.byteBudget}; }
  async read(
    context: string,
    freshFingerprint: string,
    load: () => Promise<{ fingerprint: string; data: T[] }>,
    refreshFingerprint?:()=>Promise<string>,
  ): Promise<readonly T[]> {
    const key = `${context}/${freshFingerprint}`;
    const saved = this.entries.get(key);
    if (saved) {
      this.counts.hits++;
      this.entries.delete(key);
      this.entries.set(key, saved);
      return saved.data;
    }
    const pending = this.inflight.get(key);
    const store = ({ fingerprint, data }: { fingerprint: string; data: T[] }) => {
        this.fingerprints.set(data, fingerprint);
        // String/object overhead gets a deliberately conservative structural
        // budget too; actual native memory is verified separately by the SLA.
        const bytes =
          Buffer.byteLength(JSON.stringify(data), "utf8") * 2 +
          data.length * this.rowOverheadBytes;
        const freeze = (value: unknown): void => {
          if (value && typeof value === "object" && !Object.isFrozen(value)) {
            for (const child of Object.values(value)) freeze(child);
            Object.freeze(value);
          }
        };
        freeze(data);
        if (bytes <= this.byteBudget) {
          const actualKey = `${context}/${fingerprint}`;
          this.entries.delete(actualKey);
          while (
            this.entries.size &&
            (this.entries.size >= this.capacity ||
              [...this.entries.values()].reduce((n, row) => n + row.bytes, 0) +
                bytes >
                this.byteBudget)
          ) {
            this.entries.delete(this.entries.keys().next().value!);this.counts.evictions++;
          }
          this.entries.set(actualKey, { data, bytes });
          this.counts.stores++;
        }
        return data;
    };
    const ownSnapshot=async(forceRefresh=false):Promise<readonly T[]>=>{
      // Large JSON decode/freeze allocations are serialized, not permission
      // reads. Every caller already supplied its current complete SQL hash.
      const predecessor=this.builderTail;
      let release!:()=>void;
      const completion=new Promise<void>(resolve=>release=resolve);
      this.builderTail=completion;
      if(predecessor) {this.waitingBuilders++;await predecessor;this.waitingBuilders--;}
      this.snapshotBuilders++;
      this.counts.peakSnapshotBuilders=Math.max(this.counts.peakSnapshotBuilders,this.snapshotBuilders);
      try {
        if(refreshFingerprint&&(predecessor||forceRefresh)) {
          // Queue/ABA callers perform THEIR OWN complete current SQL statement.
          // Reuse is allowed only after its hash equals retained exact content.
          const ownFingerprint=await refreshFingerprint();
          const ownKey=`${context}/${ownFingerprint}`,own=this.entries.get(ownKey);
          if(own) {
            this.entries.delete(ownKey);this.entries.set(ownKey,own);
            this.counts.queuedReuses++;return own.data;
          }
        }
        return store(await load());
      } finally {
        this.snapshotBuilders--;release();
        if(this.builderTail===completion)this.builderTail=null;
      }
    };
    if (pending) {
      this.counts.joins++;
      const joined = await pending;
      // A preflight A can race with a snapshot B and then return to A before
      // this caller's preflight. B predates this caller and may include rows
      // now hidden. Join only an EXACT matching snapshot; otherwise obtain our
      // own single SQL snapshot, never recursively rejoin the stale promise.
      if(this.fingerprintFor(joined)===freshFingerprint) return joined;
      this.counts.mismatchReloads++;return ownSnapshot(true);
    }
    this.counts.misses++;
    const work = ownSnapshot()
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    this.counts.peakInflight=Math.max(this.counts.peakInflight,this.inflight.size);
    return work;
  }
}
