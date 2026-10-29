const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const filename=path.join(__dirname,'../src/react/instance-settings-model.ts');
const code=transformSync(fs.readFileSync(filename,'utf8'),{loader:'ts',format:'cjs',target:'node22'}).code;
const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(code,filename);
const {normalizeInstanceSettings,resolveInstanceSettings}=loaded.exports;
const globalOptions={javaPath:'/java/default',memory:4096,memoryMode:'manual',optimize:true,jvmArgs:'-Dglobal',gameArgs:'--width 800'};

test('older complete instance settings remain independent after migration',()=>{
 const legacy={javaPath:'/java/legacy',memory:6144,memoryMode:'manual',optimize:false,jvmArgs:'-Dlegacy',gameArgs:''};
 const normalized=normalizeInstanceSettings(legacy);
 assert.equal(normalized.overrideJava,true);assert.equal(normalized.overrideMemory,true);assert.equal(normalized.overrideArgs,true);
 assert.deepEqual(resolveInstanceSettings(globalOptions,normalized),legacy);
});

test('each instance setting can inherit independently and invalid enabled fields are rejected',()=>{
 const memoryOnly=normalizeInstanceSettings({overrideJava:false,overrideMemory:true,overrideArgs:false,memory:8192,memoryMode:'manual'});
 assert.deepEqual(resolveInstanceSettings(globalOptions,memoryOnly),{...globalOptions,memory:8192,memoryMode:'manual'});
 assert.equal(normalizeInstanceSettings({overrideJava:false,overrideMemory:true,overrideArgs:false,memory:1,memoryMode:'manual'}),null);
 assert.equal(normalizeInstanceSettings({overrideJava:true,overrideMemory:false,overrideArgs:false,javaPath:'  '}),null);
 assert.equal(normalizeInstanceSettings([]),null);
});
