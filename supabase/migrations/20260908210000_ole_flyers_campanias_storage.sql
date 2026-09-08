-- Flyers de campañas (Tablero OLE → Abordaje): imágenes compartidas en el bucket
-- privado ole-reportes bajo el prefijo campanias/. Las sube el admin al publicar
-- (cubierto por ole_storage_write); las leen todos los asesores autenticados con
-- el flag de producción (mismo gate que los reportes).
create policy "ole_storage_select_campanias" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ole-reportes'
    and (storage.foldername(name))[1] = 'campanias'
    and private.ole_can_ver()
  );
