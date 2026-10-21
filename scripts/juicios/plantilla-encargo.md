# Encargo de juicio: {{LABEL}}

Revisas una sola pantalla o flujo de la interfaz de team-platform. Tiempo previsto: unos 5 minutos. No abras otros archivos del repositorio, no levantes servidores y no ejecutes pruebas: todo lo que necesitas está aquí y en las capturas.

## Qué miras

Abre cada una de las imágenes con la herramienta de lectura, sin saltar ninguna: cada archivo es una combinación distinta de ventana y tema. Mira la imagen, no el código. Ventana de escritorio de 1440 por 900 y de teléfono de 390 por 844, en tema claro y oscuro.

{{CAPTURES}}

## Lo que los instrumentos ya midieron

Estas dos fuentes se midieron con instrumentos y no se vuelven a reportar. Reporta sólo lo que ninguna de las dos ve: el significado de un rótulo, la jerarquía entre elementos, la composición, la consistencia con el resto del producto, lo que entendería alguien poco técnico y el flujo de la tarea.

Detectores automáticos en navegador (solapes, objetivos táctiles menores de 24 px, escala tipográfica, contraste, desbordes, scroll horizontal, alto de la página, elementos de igual peso visual):

{{DETECTORS}}

Telemetría de uso de esta pantalla (percentiles, tasas y recorridos):

{{TELEMETRY}}

## Restricciones

Son reglas del alcance, no veredictos sobre lo que ves. Lo que las contradiga no se reporta.

Decisiones del dueño que rigen aquí:

{{DECISIONS}}

Ya se midió y se refutó, y no se reporta de nuevo salvo que midas algo distinto y lo cites:

{{REFUTED}}

## Cómo se reporta

Escribe un solo archivo JSON en `{{RESULT}}`, sin texto antes ni después, con esta forma:

```json
{
  "id": "{{ID}}",
  "nota": 2,
  "desglose": [{ "criterio": "jerarquia", "puntos": 2, "porque": "una frase con un dato" }],
  "hallazgos": [
    {
      "titulo": "{{LABEL}}: lo que pasa, en una línea",
      "elemento": "el texto visible del elemento o su rol",
      "tipo": "jerarquia | rotulo | composicion | consistencia | flujo | estado | otro",
      "severidad": 3,
      "evidencia": { "captura": "nombre del archivo de la captura", "donde": "zona de la imagen o coordenadas aproximadas", "medida": "lo que mediste, con su número" },
      "reproduccion": "qué abrir y qué hacer para verlo"
    }
  ]
}
```

- Hasta 8 hallazgos, el más grave primero. Un hallazgo sin captura y sin medida no cuenta.
- Severidad de 1 a 5: 5 impide la tarea o confunde sobre un efecto real; 4 la entorpece de forma que una persona poco técnica se detiene; 3 se nota y se resuelve; 2 y 1 son pulido.
- La nota va de 1 a 5 y parte en 2. Sube sólo con evidencia citada en el desglose; un 4 exige nombrar el producto de referencia que esta pantalla iguala, con su fecha. Si hay un hallazgo de severidad 5, la nota es 1.
- Si no encuentras nada que cumpla estas reglas, devuelve `"hallazgos": []` y dilo en el desglose. Un informe corto y verificable vale más que uno largo.
