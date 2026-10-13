export function getModeLabels(config) {
  const remote=config.provider === 'openai-compatible' || config.environment === 'daytona';
  return {
    providerText:config.provider === 'openai-compatible' ? '모델 패치 생성' : '로컬 규칙 기반 수정',
    environmentText:config.environment === 'daytona' ? 'Daytona 실행' : '로컬 프로세스',
    remote,
    badge:config.transportTestDouble ? 'TEST DOUBLE' : remote ? 'INTEGRATION MODE' : 'LOCAL MVP'
  };
}
export function getView(run) {
  if (!run) return {screen:'start',busy:false,downloads:false,error:null};
  if (run.status === 'running') return {screen:'running',busy:true,downloads:false,error:null};
  if (run.status === 'completed') return {screen:'result',busy:false,downloads:['LOCAL_VERIFIED','PROVIDER_VERIFIED'].includes(run.result?.verdict) && run.result?.evidence?.transportTestDouble !== true,error:null};
  return {screen:'error',busy:false,downloads:false,error:run.error ?? {code:'UNVERIFIED',message:'실행 상태를 확인할 수 없습니다.'}};
}
