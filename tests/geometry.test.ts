import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keepVisible} from '../src/geometry.ts';
const display={x:0,y:0,width:1920,height:1040};
test('已拔掉显示器的位置能移回有效工作区',()=>{assert.deepEqual(keepVisible(3500,1400,display),{x:1844,y:964});});
test('负坐标副屏边界正确，不强行移动到主屏',()=>{assert.deepEqual(keepVisible(-2000,-20,{x:-1920,y:0,width:1920,height:1040}),{x:-1920,y:0});});
test('只在靠近边缘时吸附，保留中间位置',()=>{assert.deepEqual(keepVisible(25,300,display,76,true),{x:0,y:300});assert.deepEqual(keepVisible(1830,300,display,76,true),{x:1844,y:300});assert.deepEqual(keepVisible(500,300,display,76,true),{x:500,y:300});});
test('缩放或工作区变化后仍能完整显示',()=>{assert.deepEqual(keepVisible(1500,900,{x:0,y:0,width:1280,height:680}),{x:1204,y:604});});
