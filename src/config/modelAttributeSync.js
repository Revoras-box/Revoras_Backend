import pool from "./db.js";
import { ALL_MODELS } from "../models/index.js";

const TYPE_MAP = {
  uuid: "UUID",
  string: "VARCHAR(255)",
  text: "TEXT",
  integer: "INTEGER",
  float: "DOUBLE PRECISION",
  decimal: "NUMERIC(10,2)",
  boolean: "BOOLEAN",
  date: "DATE",
  time: "TIME",
  timestamp: "TIMESTAMPTZ",
  jsonb: "JSONB",
  enum: "TEXT",
};

const escapeLiteral = (value) => String(value).replace(/'/g, "''");

const toDefaultSql = (value, type) => {
  if (value === "now") return "NOW()";
  if (typeof value === "number") return `${value}`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value === null) return "NULL";
  if (type === "jsonb" && (Array.isArray(value) || typeof value === "object")) {
    return `'${escapeLiteral(JSON.stringify(value))}'::jsonb`;
  }
  return `'${escapeLiteral(value)}'`;
};

const getSqlType = (definition) => TYPE_MAP[definition.type] || "TEXT";

const buildCreateColumnSql = ([columnName, definition]) => {
  let sql = `"${columnName}" ${getSqlType(definition)}`;

  if (definition.primaryKey) sql += " PRIMARY KEY";
  if (definition.required && !definition.primaryKey) sql += " NOT NULL";
  if (definition.unique) sql += " UNIQUE";
  if ("default" in definition) {
    sql += ` DEFAULT ${toDefaultSql(definition.default, definition.type)}`;
  }

  return sql;
};

const buildAlterColumnSql = ([columnName, definition]) => {
  let sql = `"${columnName}" ${getSqlType(definition)}`;

  if ("default" in definition) {
    sql += ` DEFAULT ${toDefaultSql(definition.default, definition.type)}`;
  }

  return sql;
};

const tableExists = async (tableName) => {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS exists;
    `,
    [tableName]
  );

  return result.rows[0]?.exists === true;
};

const getTableColumns = async (tableName) => {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1;
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
};

export const ensureModelAttributes = async () => {
  let createdTables = 0;
  let addedColumns = 0;

  for (const model of ALL_MODELS) {
    const { table, columns } = model;
    const columnEntries = Object.entries(columns);
    const exists = await tableExists(table);

    if (!exists) {
      const createColumnsSql = columnEntries.map(buildCreateColumnSql).join(", ");
      await pool.query(`CREATE TABLE IF NOT EXISTS "${table}" (${createColumnsSql});`);
      createdTables += 1;
      continue;
    }

    const existingColumns = await getTableColumns(table);
    const missingColumns = columnEntries.filter(([columnName]) => !existingColumns.has(columnName));

    for (const columnEntry of missingColumns) {
      const addColumnSql = buildAlterColumnSql(columnEntry);
      await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${addColumnSql};`);
      addedColumns += 1;
    }
  }

  console.log(
    `[db-sync] Schema check finished: ${createdTables} tables created, ${addedColumns} columns added.`
  );
};
