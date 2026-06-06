function generarIdCuenta() { return 'cta_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function generarIdEtiqueta() { return 'tag_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function generarIdOperacion() { return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function generarIdMetaSimple() { return 'simple_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

function parsearLineaCSV(str) {
  let resultado = [];
  let valorActual = '';
  let entreComillas = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') { entreComillas = !entreComillas; } 
    else if (char === ',' && !entreComillas) { resultado.push(valorActual.trim()); valorActual = ''; } 
    else { valorActual += char; }
  }
  resultado.push(valorActual.trim());
  return resultado;
}

const normalizar = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
};

export function procesarCSVBudge(contenidoCSV, cuentasExistentes = [], etiquetasExistentes = [], operacionesExistentes = [], metasExistentes = []) {
  const secciones = contenidoCSV.split('###');
  const transaccionesCSV = secciones[0] || '';
  const cuentasCSV = secciones[1] || '';
  const metasCSV = secciones[2] || '';
  
  const registrosCSV = [];
  const cuentasParseadas = [];
  const metasParseadas = [];
  
  // Parsear transacciones
  const lineasTrans = transaccionesCSV.split('\n');
  let iniciandoTrans = false;
  for (let linea of lineasTrans) {
    linea = linea.trim();
    if (!linea) continue;
    if (linea.startsWith('Date,Payment,Is paid,Amount,Currency,Account,Category,Subcategory,Goal,Description')) {
      iniciandoTrans = true;
      continue;
    }
    if (!iniciandoTrans) continue;
    
    const valores = parsearLineaCSV(linea);
    if (valores.length < 10) continue;
    
    let [DateStr, Payment, IsPaid, AmountStr, Currency, Account, Category, Subcategory, Goal, Description] = valores;
    
    const partesFecha = DateStr.split('-');
    if (partesFecha.length !== 3) continue;
    const fechaYYYYMMDD = `${partesFecha[2]}-${partesFecha[1]}-${partesFecha[0]}`;
    const fechaISO = `${fechaYYYYMMDD}T00:00:00.000Z`;
    
    const cantidad = parseFloat(AmountStr.replace(/,/g, ''));
    if (isNaN(cantidad)) continue;

    registrosCSV.push({
      fechaISO,
      fechaYYYYMMDD,
      nombre: Payment,
      cantidad,
      cuenta: Account,
      categoriaPadre: Category,
      categoriaHijo: Subcategory,
      descripcion: Description || ''
    });
  }

  // Parsear cuentas
  const lineasCuentas = cuentasCSV.split('\n');
  let iniciandoCuentas = false;
  for (let linea of lineasCuentas) {
    linea = linea.trim();
    if (!linea) continue;
    if (linea.startsWith('Account,Account Balance,Available Balance,Credit Limit,Currency,Is savings,Description')) {
      iniciandoCuentas = true; continue;
    }
    if (!iniciandoCuentas) continue;
    const valores = parsearLineaCSV(linea);
    if (valores.length < 7) continue;
    let [Account, AccountBalance, AvailableBalance, CreditLimit, Currency, IsSavings, Description] = valores;
    
    const saldo = parseFloat(AccountBalance.replace(/,/g, ''));
    if (isNaN(saldo)) continue;

    cuentasParseadas.push({
       nombre: Account,
       saldo,
       esSubcuenta: IsSavings.trim().toLowerCase() === 'true',
       descripcion: Description || ''
    });
  }

  // Parsear metas
  const lineasMetas = metasCSV.split('\n');
  let iniciandoMetas = false;
  for (let linea of lineasMetas) {
    linea = linea.trim();
    if (!linea) continue;
    if (linea.startsWith('Goal,Required sum,Required sum currency,Accumulated sum,Accumulated sum currency,Planned expense date,Category,Subcategory,Description')) {
       iniciandoMetas = true; continue;
    }
    if (!iniciandoMetas) continue;
    const valores = parsearLineaCSV(linea);
    if (valores.length < 9) continue;
    let [Goal, RequiredSum, RequiredCurrency, AccumulatedSum, AccumulatedCurrency, PlannedDate, Category, Subcategory, Description] = valores;
    
    const requerido = parseFloat(RequiredSum.replace(/,/g, ''));
    const acumulado = parseFloat(AccumulatedSum.replace(/,/g, ''));
    
    if (isNaN(requerido) || isNaN(acumulado)) continue;

    let fechaFinISO = null;
    if (PlannedDate) {
      const p = PlannedDate.split('-');
      if (p.length === 3) fechaFinISO = `${p[2]}-${p[1]}-${p[0]}T00:00:00.000Z`;
    }

    metasParseadas.push({
       nombre: Goal,
       requerido,
       acumulado,
       fechaFinISO,
       descripcion: Description || ''
    });
  }

  // 1. Agrupar transferencias
  const transferenciasIn = [];
  const transferenciasOut = [];
  const operacionesSueltas = [];

  for (const reg of registrosCSV) {
    if (reg.categoriaPadre === 'Transferencia') {
      if (reg.cantidad < 0) transferenciasOut.push(reg);
      else transferenciasIn.push(reg);
    } else {
      operacionesSueltas.push(reg);
    }
  }

  const transferenciasEmparejadas = [];
  for (let i = 0; i < transferenciasOut.length; i++) {
    const outReg = transferenciasOut[i];
    if (outReg.emparejado) continue;
    const inIdx = transferenciasIn.findIndex(inReg => 
      !inReg.emparejado && 
      inReg.fechaYYYYMMDD === outReg.fechaYYYYMMDD && 
      Math.abs(inReg.cantidad) === Math.abs(outReg.cantidad)
    );
    if (inIdx !== -1) {
      const inReg = transferenciasIn[inIdx];
      outReg.emparejado = true;
      inReg.emparejado = true;
      transferenciasEmparejadas.push({ origenReg: outReg, destinoReg: inReg });
    } else {
      operacionesSueltas.push(outReg);
    }
  }
  for (const inReg of transferenciasIn) {
    if (!inReg.emparejado) operacionesSueltas.push(inReg);
  }

  const mapCuentas = new Map(); // key normalizada => obj cuenta (existente o nueva)
  const mapEtiquetas = new Map();

  for (const c of cuentasExistentes) {
    mapCuentas.set(normalizar(c.nombre), { ...c }); 
  }
  for (const e of etiquetasExistentes) {
    mapEtiquetas.set(normalizar(e.nombre), { ...e });
  }

  const nuevasCuentasAgregadas = [];
  const cuentasAActualizar = []; 

  // Combinar saldos parseados
  for (const cp of cuentasParseadas) {
    const key = normalizar(cp.nombre);
    if (mapCuentas.has(key)) {
      const cuentaExistente = mapCuentas.get(key);
      cuentaExistente.dinero = cp.saldo; // Actualizamos saldo
      cuentaExistente.esSubcuenta = cp.esSubcuenta;
      cuentasAActualizar.push(cuentaExistente);
    } else {
      const nuevaCuenta = {
        id: generarIdCuenta(),
        nombre: cp.nombre,
        descripcion: cp.descripcion || 'Importada de Budge',
        color: '#0ea5e9',
        dinero: cp.saldo,
        parentId: null,
        esSubcuenta: cp.esSubcuenta,
        creadaEn: new Date().toISOString(),
        actualizadaEn: new Date().toISOString(),
        historial: [{ fecha: new Date().toISOString(), tipo: 'creacion', mensaje: 'Importada de Budge con saldo inicial de $' + cp.saldo }]
      };
      mapCuentas.set(key, nuevaCuenta);
      nuevasCuentasAgregadas.push(nuevaCuenta);
    }
  }

  const obtenerIdCuenta = (nombre) => {
    if (!nombre) return null;
    const key = normalizar(nombre);
    if (mapCuentas.has(key)) return mapCuentas.get(key).id;
    
    // Si la operación menciona una cuenta que no estaba en el bloque Accounts ni existía
    const nuevaCuenta = {
      id: generarIdCuenta(), nombre, descripcion: 'Importada automáticamente de operaciones Budge', color: '#0ea5e9', dinero: 0,
      parentId: null, esSubcuenta: false, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
    };
    mapCuentas.set(key, nuevaCuenta);
    nuevasCuentasAgregadas.push(nuevaCuenta);
    return nuevaCuenta.id;
  };

  const nuevasEtiquetas = [];
  const obtenerIdEtiqueta = (padre, hijo, esIngreso) => {
    const nombreReal = hijo ? hijo : padre;
    if (!nombreReal) return null;
    const key = normalizar(nombreReal);
    
    if (mapEtiquetas.has(key)) return mapEtiquetas.get(key).id;
    
    let padreId = null;
    if (padre && hijo) {
      const keyPadre = normalizar(padre);
      if (mapEtiquetas.has(keyPadre)) {
        padreId = mapEtiquetas.get(keyPadre).id;
      } else {
        padreId = generarIdEtiqueta();
        const nuevaEtiPadre = {
          id: padreId, nombre: padre, color: '#0ea5e9', tipo: esIngreso ? 'ingreso' : 'gasto',
          icono: '🏷️', padreId: null, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
        };
        mapEtiquetas.set(keyPadre, nuevaEtiPadre);
        nuevasEtiquetas.push(nuevaEtiPadre);
      }
    }
    
    const id = generarIdEtiqueta();
    const nuevaEti = {
      id, nombre: nombreReal, color: '#0ea5e9', tipo: esIngreso ? 'ingreso' : 'gasto',
      icono: '🏷️', padreId, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
    };
    mapEtiquetas.set(key, nuevaEti);
    nuevasEtiquetas.push(nuevaEti);
    return id;
  };

  const esOperacionDuplicada = (fechaYYYYMMDD, cantidad, tipo) => {
    return operacionesExistentes.some(op => {
      const opFechaStr = op.fecha.substring(0, 10);
      return opFechaStr === fechaYYYYMMDD && Math.abs(op.cantidad) === Math.abs(cantidad) && op.tipo === tipo;
    });
  };

  const nuevasOperaciones = [];
  for (const pair of transferenciasEmparejadas) {
    if (esOperacionDuplicada(pair.origenReg.fechaYYYYMMDD, Math.abs(pair.origenReg.cantidad), 'transferencia')) continue;
    const origenId = obtenerIdCuenta(pair.origenReg.cuenta);
    const destinoId = obtenerIdCuenta(pair.destinoReg.cuenta);
    nuevasOperaciones.push({
      id: generarIdOperacion(), tipo: 'transferencia', nombre: pair.origenReg.nombre || 'Transferencia', descripcion: pair.origenReg.descripcion,
      cantidad: Math.abs(pair.origenReg.cantidad), fecha: pair.origenReg.fechaISO, origenId, destinoId, estado: 'pagado', creadaEn: new Date().toISOString()
    });
  }

  for (const reg of operacionesSueltas) {
    const esIngreso = reg.cantidad > 0;
    const tipo = esIngreso ? 'ingreso' : 'gasto';
    if (esOperacionDuplicada(reg.fechaYYYYMMDD, Math.abs(reg.cantidad), tipo)) continue;
    const cuentaId = obtenerIdCuenta(reg.cuenta);
    const etiquetaId = obtenerIdEtiqueta(reg.categoriaPadre, reg.categoriaHijo, esIngreso);
    nuevasOperaciones.push({
      id: generarIdOperacion(), tipo, nombre: reg.nombre, descripcion: reg.descripcion, etiquetaId,
      cantidad: Math.abs(reg.cantidad), fecha: reg.fechaISO, cuentaId, estado: 'pagado', creadaEn: new Date().toISOString()
    });
  }

  // Procesar Metas Simples
  const nuevasMetas = [];
  for (const mp of metasParseadas) {
    // Verificar si ya existe en metasExistentes por nombre normalizado
    const duplicada = metasExistentes.some(m => m.tipo === 'simple' && normalizar(m.nombre) === normalizar(mp.nombre));
    if (duplicada) continue;

    // Crear subcuenta espejo para el saldo acumulado
    const nombreEspejo = `Meta: ${mp.nombre}`;
    const idCuentaEspejo = generarIdCuenta();
    const nuevaCuentaEspejo = {
      id: idCuentaEspejo,
      nombre: nombreEspejo,
      descripcion: mp.descripcion || 'Cuenta espejo para meta de Budge',
      color: '#f59e0b',
      dinero: mp.acumulado,
      parentId: null,
      esSubcuenta: true,
      creadaEn: new Date().toISOString(),
      actualizadaEn: new Date().toISOString(),
      historial: [{ fecha: new Date().toISOString(), tipo: 'creacion', mensaje: `Cuenta creada automáticamente por importación de meta.` }]
    };
    nuevasCuentasAgregadas.push(nuevaCuentaEspejo);

    // Crear la Meta Simple
    nuevasMetas.push({
      id: generarIdMetaSimple(),
      tipo: 'simple',
      nombre: mp.nombre,
      cuentaId: idCuentaEspejo,
      objetivo: mp.requerido,
      color: '#f59e0b',
      activo: true,
      completada: mp.acumulado >= mp.requerido,
      ultimoSaldo: mp.acumulado,
      creadaEn: new Date().toISOString(),
      historial: [{ fecha: new Date().toISOString(), tipo: 'config', mensaje: 'Importada desde Budge' }]
    });
  }

  // Juntamos todo
  // mapCuentas tiene todas las cuentas combinadas/actualizadas. 
  // Para devolver la DB final de cuentas combinada, iteramos el mapCuentas.
  const cuentasFinales = Array.from(mapCuentas.values());

  return { 
    cuentasFinales, 
    nuevasCuentasAgregadas, // Si quisiéramos diferenciarlas
    nuevasEtiquetas, 
    nuevasOperaciones, 
    nuevasMetas,
    totalProcesadasCSV: registrosCSV.length 
  };
}
