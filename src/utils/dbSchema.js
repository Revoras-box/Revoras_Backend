const INTEGER_TYPES = new Set(["smallint", "integer", "bigint"]);
const idTypeCache = new Map();

export const getTableIdType = async (db, tableName) => {
  if (idTypeCache.has(tableName)) {
    return idTypeCache.get(tableName);
  }

  const result = await db.query(
    `SELECT data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
     LIMIT 1`,
    [tableName]
  );

  const row = result.rows[0];
  const idType = row?.data_type || row?.udt_name || null;
  idTypeCache.set(tableName, idType);
  return idType;
};

export const tableHasIntegerId = async (db, tableName) => {
  const idType = await getTableIdType(db, tableName);
  return INTEGER_TYPES.has(idType);
};

