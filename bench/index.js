// Punto de entrada de `node --test bench/`. Node 24 trata el argumento "bench/" como un módulo
// y no recorre la carpeta; este archivo carga las pruebas del banco. Con `node --test` sin
// argumentos, Node encuentra los *.test.js por su cuenta y este archivo no se ejecuta.
import './score.test.js';
import './cases.test.js';
import './run.test.js';
