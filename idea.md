Hoy, en algunos proyectos en los que soy el desarrollador principal, la comunicación vive dispersa en los chats de grupos de trabajo. Algunos prefieren escribir mails, otros enviar screenshots acompañados de audio en un grupo, otros prefieren un video narrado, otros envían documentos y texto. Los reportes de bugs se mezclan con requerimientos nuevos, con la retroalimentación, y con ideas exploratorias o conversación casual.

Para el equipo, esto dificulta:

- Ordenar, categorizar y asignar el trabajo a realizar.

- Responder individual y oportunamente a cada mensaje, petición, reporte o idea en el grupo.

- Llevar trazabilidad del trabajo realizado.



Team-platform, en su fase inicial, será un proyecto open source para facilitar la comunicación entre un equipo pequeño de 3 a 10 miembros, cada uno con distintas responsabilidades y dominios.

Definiremos los conceptos de área, mensaje, respuesta, hilo y área.

Mensaje: Una comunicación de una persona hacia el equipo o a un miembro en particular. Puede ser un reporte de bug, una pregunta, retroalimentación, una idea, etc. Siempre se espera una respuesta. Un mensaje puede estar abierto (sin respuesta), respondido (con respuesta y no cerrado) o cerrado (con o sin respuesta). Un mensaje solo puede responderse por un miembro distinto al emisor, pero puede ser cerrado o reabierto por cualquier miembro.

Respuesta: La contraparte al mensaje. Puede ser una respuesta directa, un reporte de fix, solicitud de clarificación, etc. Depende de un mensaje.

Hilo: Cuando una respuesta es seguida de otra respuesta más, se crea un hilo. En la práctica, esto es para mantener una conversación sobre un tema en particular. Comportamiento similar a los comentarios de github issues. 

Área: La categoría o clasificación que puede tener un mensaje. Se asume que toda la comunicación interna del equipo de un proyecto, que busque respuesta de uno o varios miembros, puede categorizarse en áreas mutuamente excluyentes y colectivamente exhaustivas. Por ejemplo: [idea, bug, nueva funcionalidad, retroalimentación, pregunta]. 

La idea es que cada miembro mantenga su forma de comunicar preferida, y la plataforma centralice la comunicación de mensajes y los coloque en sus áreas respectivas, asignándolos tentativamente a uno o varios miembros. En su pantalla de inicio ofrecerá una barra que permitirá hacer una, varias o todas las acciones siguientes:

- Escribir un mensaje con el teclado

- Adjuntar una o varias fotos

- Adjuntar uno o varios videos

- Adjuntar uno o varios documentos

- Adjuntar uno o varios links

La mecánica central del sitio será que un LLM en un harness en modo desatendido (como claude code o Kilo code), analizará el mensaje y sus adjuntos utilizando un método estructurado, inferirá el área correspondiente, y seguirá la plantilla de trabajo del área que más se adecúe, indicando su nivel de progreso en % y frases breves mientras trabaja. 

Luego, el mensaje original queda descompuesto en N mensajes, cada uno redactado segun los campos que describa la plantilla y asignado, opcionalmente, a el o los miembros más apropiados para la tarea según los datos de cada miembro, sobre todo si se les encarga por nombre. La idea es que un mensaje original que puede contener mucha información dispersa se descomponga en la mínima cantidad de mensajes necesarios usando un criterio MECE. Así, puede subirse una captura de grupo de chat, un .docx con +40 puntos de feedback, o una transcripcion de monólogo durante una prueba, y resulta en uno o varios mensajes que agrupen el trabajo en categorías de forma eficiente y coherente.  con el objetivo de que un input 



La plataforma tendrá las siguientes vistas:

- Inicio: Nombre del proyecto, fecha y hora actuales, barra de envío de mensaje con opción de adjuntos, sección de previsualización de mensaje, adjuntos y vista previa de medios, sección de análisis IA segun plantilla por área detectada, sección de últimos mensajes filtrando por defecto los que son para el usuario, sección de últimas respuestas priorizando por defecto las respuestas e hilos que involucren al usuario

- Mensajes: Sección de todos los hilos del equipo con filtros, búsqueda, y features de calidad de vida. Permite categorizar por mensajes, respuestas, mensajes para mi, mensajes para X miembro, etc. de forma intuitiva y con buena UX. 

- Equipo: Sección para ver los miembros del equipo, descripción breve de sus responsabilidades y dominio(s). Los usuarios pueden editar solo su propia descripción y dominios.

- Conexiones (apagada por ahora): Sección para gestionar conexiones uni o bidireccionales con canales como correo, whatsapp, API, MCP, etc. Se implementarán conexiones cuando se pruebe que el sistema funciona bien independientemente de la procedencia y estructura de su input, descomponiendo el input en elementos accionables y categorizados.

- Configuración: Configuración de la cuenta y algunas opciones visuales.



Adicionalmente, el usuario que tenga rol Editor podrá ver y gestionar la pestaña áreas y plantillas. 

Un área se tiene título y descripción. N áreas pueden tener N plantillas, cada plantilla corresponde a 1 área. Las plantillas son un archivo markdown que la metodologia para analizar el input y el formato de output. Cada plantilla tiene un nombre y una descripción. La IA que analiza recibe todas las descripciones y titulos de cada area, asi como todos los titulos y descripciones de las plantillas de cada área. Esto permite que la IA categorice mensajes por área y por títulos. 

La implementación ideal de este software debería permitir que un input cualquiera, que sea plausiblemente de utilidad accionable para el equipo, independiente de su nivel de entropía, complejidad y variedad de adjuntos, se descomponga de manera idempotente en un conjunto MECE de Mensajes correctamente categorizados, descritos y asignados, cada uno con el o los adjuntos que puedan ayudar o contextualizar su contenido. Un adjunto puede asociarse a varios mensajes (por ej; si un mensaje es sobre elementos desalineados de la vista “dashboard” y otro es sobre una feature para agregar la sincronización con whatsapp en el sidebar de un saas, para ambos correspondería la captura de pantalla completa que contiene el dashboard y el sidebar.)

Además, la idea es que team-platform corra en un stack moderno y ligero, modular, adaptable a la base sobre la que se corre y con los mínimos componentes necesarios para su funcionamiento.Algo tipo Docker[React+Refine,TailScale,SQlite,Harness]. 

Implementar team-platform en un proyecto existente debe ser fácil, así como servirlo en un VPS por si solo.
