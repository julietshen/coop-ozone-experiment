-- Add handle and display_name fields to the Post content type
-- so the MRT UI can show who authored each post.
UPDATE public.item_types
SET fields = '{"{\"name\": \"text\", \"type\": \"STRING\", \"required\": true, \"container\": null}","{\"name\": \"images\", \"type\": \"ARRAY\", \"required\": true, \"container\": {\"containerType\": \"ARRAY\", \"keyScalarType\": null, \"valueScalarType\": \"IMAGE\"}}","{\"name\": \"owner_id\", \"type\": \"ID\", \"required\": true, \"container\": null}","{\"name\": \"handle\", \"type\": \"STRING\", \"required\": false, \"container\": null}","{\"name\": \"display_name\", \"type\": \"STRING\", \"required\": false, \"container\": null}","{\"name\": \"num_likes\", \"type\": \"NUMBER\", \"required\": true, \"container\": null}","{\"name\": \"num_comments\", \"type\": \"NUMBER\", \"required\": true, \"container\": null}","{\"name\": \"num_user_reports\", \"type\": \"NUMBER\", \"required\": true, \"container\": null}"}'
WHERE id = 'a8481310e8c'
  AND name = 'Post';
