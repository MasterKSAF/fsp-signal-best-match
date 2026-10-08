/** Fixed editorial presentation schedule. Selection uses only public scenario parameters, never
 * option length, key quality, test scores or adversarial measurements. Both pools are authored wrong plans. */
export function reviewedSkillContrastsV6(correctIndex:number,base:readonly string[],compact:readonly string[],c:number,s:number,n:number,flag:boolean):string[]{
 if(base.length!==4||compact.length!==3||correctIndex<0||correctIndex>3)throw new Error('Invalid reviewed contrast');
 const expanded=base.filter((_x,i)=>i!==correctIndex);const compactCount=(n-5+c+s+Number(flag))%4;
 const rotation=(c+s+n+Number(flag))%3;const rotate=(pool:readonly string[])=>[...pool.slice(rotation),...pool.slice(0,rotation)];
 const wrong=[...rotate(compact).slice(0,compactCount),...rotate(expanded).slice(0,3-compactCount)];wrong.splice(correctIndex,0,base[correctIndex]!);
 if(new Set(wrong).size!==4)throw new Error('Duplicated authored contrast');return wrong;
}
