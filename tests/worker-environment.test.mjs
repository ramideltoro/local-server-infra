import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedWorkerEnvironment} from '../services/recovery/worker-environment.mjs';
test('every deployed backend URL spelling resolves only to the restored local dependency',()=>{
 const original={NUTSNEWS_SCHEDULER_BACKEND_API_URL:'https://production.example',NUTSNEWS_PERSISTENCE_BACKEND_API_BASE_URL:'https://production.example',NUTSNEWS_TRANSLATION_QWEN_BASE_URL:'https://model.example',NUTSNEWS_TRANSLATION_DATABASE_URL:'postgres://role:secret@db.example:5432/restored',NUTSNEWS_TRANSLATION_RABBITMQ_URL:'amqp://role:secret@queue.example/vhost',NUTSNEWS_SCHEDULER_SHADOW_MODE:'true'};
 const env=isolatedWorkerEnvironment(original,'isolated');
 assert.equal(env.NUTSNEWS_SCHEDULER_BACKEND_API_URL,'http://127.0.0.1:8093');assert.equal(env.NUTSNEWS_PERSISTENCE_BACKEND_API_BASE_URL,'http://127.0.0.1:8093');assert.equal(env.NUTSNEWS_TRANSLATION_QWEN_BASE_URL,'http://127.0.0.1:8788');
 for(const key of ['NUTSNEWS_TRANSLATION_DATABASE_URL','NUTSNEWS_TRANSLATION_RABBITMQ_URL'])assert.equal(new URL(env[key]).hostname,'127.0.0.1');
 assert.equal(new URL(env.NUTSNEWS_TRANSLATION_RABBITMQ_URL).password,'isolated');assert.equal(env.NUTSNEWS_SCHEDULER_SHADOW_MODE,'true');assert.equal(original.NUTSNEWS_SCHEDULER_BACKEND_API_URL,'https://production.example');
});
