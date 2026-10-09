import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver, MutationObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { completeJobApplication } from '../artifacts/fsp-signal/src/lib/job-application-submit';

test('successful application still navigates when refreshing applications unmounts the submitting observer',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  const key=['my-applications',314,'all-status'];
  let saved:{id:number;resumeId:number;jobId:number}[]=[];
  client.setQueryData(key,saved);
  let observerCallback=0,navigated=0,formUnmounted=false;
  const mutation=new MutationObserver(client,{
    mutationFn:async(payload:{resumeId:number;jobId:number;consentDisclosure:boolean})=>{
      assert.equal(payload.consentDisclosure,true);
      saved=[{id:21,resumeId:payload.resumeId,jobId:payload.jobId}];
      return saved[0];
    },
    onSuccess:()=>client.invalidateQueries({queryKey:['my-applications']}),
  });
  const stopForm=mutation.subscribe(()=>{});
  const query=new QueryObserver(client,{queryKey:key,queryFn:async()=>saved,staleTime:Infinity});
  const stopQuery=query.subscribe(result=>{
    if(result.data?.length){formUnmounted=true;stopForm();}
  });
  try{
    await completeJobApplication(
      ()=>mutation.mutate({resumeId:296,jobId:38,consentDisclosure:true},{onSuccess:()=>{observerCallback++;}}),
      ()=>{assert.equal(formUnmounted,true);navigated++;},
    );
    assert.equal(observerCallback,0,'negative control: the former per-call callback really is skipped');
    assert.equal(navigated,1);
    assert.deepEqual(client.getQueryData(key),[{id:21,resumeId:296,jobId:38}]);
  }finally{stopForm();stopQuery();client.clear();}
});

test('failed submission keeps the error and never navigates to an invented successful application',async()=>{
  const client=new QueryClient();
  const failure=new Error('Вакансия изменилась. Обновите данные.');
  const mutation=new MutationObserver(client,{mutationFn:async()=>{throw failure;},retry:false});
  let navigated=false;
  const stop=mutation.subscribe(()=>{});
  try{
    await completeJobApplication(()=>mutation.mutate(undefined),()=>{navigated=true;});
    assert.equal(navigated,false);
    assert.equal(mutation.getCurrentResult().error,failure);
  }finally{stop();client.clear();}
});
