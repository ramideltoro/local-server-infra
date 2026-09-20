// Only applied to the disposable restored copy. The namespace has no external network.
export function isolatedWorkerEnvironment(original,password){
 const env={...original};
 for(const [key,value]of Object.entries(env)){
  if(key.endsWith('_DATABASE_URL')||key.endsWith('_RABBITMQ_URL')){const url=new URL(value);url.hostname='127.0.0.1';url.port=key.endsWith('_DATABASE_URL')?'55432':'5672';if(key.endsWith('_RABBITMQ_URL'))url.password=password;env[key]=url.toString();}
  if(key.endsWith('_BACKEND_API_BASE_URL')||key.endsWith('_BACKEND_API_URL'))env[key]='http://127.0.0.1:8093';
  if(key.endsWith('_HTTP_HOST'))env[key]='127.0.0.1';
  if(key.endsWith('_HTTP_PORT'))env[key]='8080';
  if(key.endsWith('_QWEN_BASE_URL'))env[key]='http://127.0.0.1:8788';
 }
 return env;
}
