// Entry point of `node --test bench/`. Node 24 treats the "bench/" argument as a module
// and does not walk the folder; this file loads the bench tests. With `node --test` without
// arguments, Node finds the *.test.js files on its own and this file does not run.
import './score.test.js';
import './cases.test.js';
import './run.test.js';
