/* Doble de better-sqlite3: entiende solo las sentencias que usa el servidor,
   y guarda las filas en un objeto compartido para poder simular un reinicio. */
const almacenes = {};

class Sentencia {
  constructor(sql, tablas) { this.sql = sql.replace(/\s+/g, ' ').trim(); this.t = tablas; }

  run(...args) {
    const a = args[0];
    if (/^INSERT (OR IGNORE )?INTO lecturas/i.test(this.sql)) {
      const clave = a.estacion + '|' + a.momento;
      if (this.t.lecturas.some((f) => f.estacion + '|' + f.momento === clave)) return { changes: 0 };
      this.t.lecturas.push({ ...a }); return { changes: 1 };
    }
    if (/^INSERT INTO solicitudes/i.test(this.sql)) { this.t.solicitudes.push({ ...a }); return { changes: 1 }; }
    if (/^INSERT INTO sesiones/i.test(this.sql)) {
      this.t.sesiones.push({ token: args[0], usuario: args[1], expira: args[2] }); return { changes: 1 };
    }
    if (/^DELETE FROM sesiones WHERE token/i.test(this.sql)) {
      const n = this.t.sesiones.length;
      this.t.sesiones = this.t.sesiones.filter((s) => s.token !== args[0]);
      return { changes: n - this.t.sesiones.length };
    }
    if (/^DELETE FROM sesiones WHERE expira/i.test(this.sql)) {
      const n = this.t.sesiones.length;
      this.t.sesiones = this.t.sesiones.filter((s) => s.expira >= args[0]);
      return { changes: n - this.t.sesiones.length };
    }
    throw new Error('sentencia no contemplada en el doble: ' + this.sql);
  }

  get(...args) {
    if (/FROM sesiones WHERE token/i.test(this.sql)) {
      return this.t.sesiones.find((s) => s.token === args[0]) || undefined;
    }
    throw new Error('get no contemplado: ' + this.sql);
  }

  all(...args) {
    if (/FROM lecturas/i.test(this.sql)) {
      const [est, desde, hasta] = args;
      return this.t.lecturas
        .filter((f) => f.estacion === est && f.momento >= desde && f.momento <= hasta)
        .sort((x, y) => (x.momento < y.momento ? 1 : -1));
    }
    if (/FROM solicitudes/i.test(this.sql)) {
      return this.t.solicitudes
        .map((f) => ({ id: f.id, creada: f.creada, documento: f.documento, nombre: f.nombre,
          institucion: f.institucion, correo: f.correo, estacion: f.estacion,
          variables: f.variables, desde: f.desde, hasta: f.hasta, proposito: f.proposito,
          estado: f.estado || 'Recibida' }))
        .sort((x, y) => (x.creada < y.creada ? 1 : -1));
    }
    throw new Error('all no contemplado: ' + this.sql);
  }
}

module.exports = class Database {
  constructor(archivo) {
    if (!almacenes[archivo]) almacenes[archivo] = { lecturas: [], solicitudes: [], sesiones: [] };
    this.t = almacenes[archivo];
  }
  pragma() {}
  exec() {}
  prepare(sql) { return new Sentencia(sql, this.t); }
};
