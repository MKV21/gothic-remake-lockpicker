DELETE FROM lock_names
WHERE source = 'auto-solve'
  AND normalized_name = 'unnamed lock';
