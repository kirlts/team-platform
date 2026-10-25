-- El aviso de una sesión fallida queda marcado cuando «Reintentar» lanza otra (UD-290). Forward only; el ejecutor abre la transacción.
--   replies.replaced_by_job_id  el trabajo que lo reemplazó (NULL mientras nadie reintentó). El aviso no se borra, para que la auditoría lo conserve; el hilo
--                               lo dibuja como «Reintentando» mientras ese trabajo está en cola o corriendo y lo omite cuando termina, porque su resultado
--                               (la respuesta, o un aviso nuevo con su motivo) ya ocupa su lugar.
ALTER TABLE replies ADD COLUMN replaced_by_job_id INTEGER;
