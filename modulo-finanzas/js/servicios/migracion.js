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

export function procesarCSVBudge(contenidoCSV, cuentasExistentes = [], etiquetasExistentes = [], operacionesExistentes = [], metasExistentes = [], mapeoCuentas = null, mapeoEtiquetas = null) {
  const secciones = contenidoCSV.split('###');
  
  let transaccionesCSV = '';
  let cuentasCSV = '';
  let metasCSV = '';
  
  for (const sec of secciones) {
    if (sec.includes('Date,Payment,Is paid,Amount')) transaccionesCSV = sec;
    else if (sec.includes('Account,Account Balance,Available Balance')) cuentasCSV = sec;
    else if (sec.includes('Goal,Required sum,Required sum currency')) metasCSV = sec;
  }
  
  const registrosCSV = [];
  const cuentasParseadas = [];
  const metasParseadas = [];
  
  // Mapeos para análisis visual
  const analisisCuentasMap = new Map();
  const analisisEtiquetasMap = new Map();
  
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

    const esIngreso = cantidad > 0;
    
    if (Account) {
      analisisCuentasMap.set(normalizar(Account), { nombre: Account, saldo: null, esSubcuenta: false, descripcion: '' });
    }
    
    if (Category !== 'Transferencia') {
      const nombreEtiqueta = Subcategory ? Subcategory : Category;
      if (nombreEtiqueta) {
        analisisEtiquetasMap.set(normalizar(nombreEtiqueta), { nombre: nombreEtiqueta, padre: Category, hijo: Subcategory, tipo: esIngreso ? 'ingreso' : 'gasto' });
      }
    }

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

    const objCuenta = {
       nombre: Account,
       saldo,
       esSubcuenta: IsSavings.trim().toLowerCase() === 'true',
       descripcion: Description || ''
    };
    cuentasParseadas.push(objCuenta);
    analisisCuentasMap.set(normalizar(Account), objCuenta);
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

  // --- Fase 1: Análisis (Retornamos para que el UI muestre el modal de mapeo) ---
  if (!mapeoCuentas || !mapeoEtiquetas) {
    const analisisCuentas = [];
    const analisisEtiquetas = [];
    
    for (const [key, val] of analisisCuentasMap.entries()) {
      const localMatch = cuentasExistentes.find(c => normalizar(c.nombre) === key);
      analisisCuentas.push({
        ...val,
        keyNormalizada: key,
        idSugerido: localMatch ? localMatch.id : 'NUEVA'
      });
    }
    
    for (const [key, val] of analisisEtiquetasMap.entries()) {
      const localMatch = etiquetasExistentes.find(e => normalizar(e.nombre) === key);
      analisisEtiquetas.push({
        ...val,
        keyNormalizada: key,
        idSugerido: localMatch ? localMatch.id : 'NUEVA'
      });
    }
    
    return {
      requiereMapeo: true,
      totalProcesadasCSV: registrosCSV.length,
      analisisCuentas,
      analisisEtiquetas
    };
  }

  // --- Fase 2: Ejecución con mapeos provistos ---
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

  const mapCuentasFinales = new Map();
  for (const c of cuentasExistentes) {
    mapCuentasFinales.set(c.id, { ...c }); 
  }
  
  const mapEtiquetasFinales = new Map();
  for (const e of etiquetasExistentes) {
    mapEtiquetasFinales.set(e.id, { ...e });
  }

  const nuevasCuentasAgregadas = [];
  const nuevasEtiquetasAgregadas = [];

  // Resolver Mapeos de Cuentas
  const idCuentasResolver = new Map(); // key normalizada => ID local definitivo
  for (const [key, val] of analisisCuentasMap.entries()) {
    let idAsignado = mapeoCuentas[key];
    if (!idAsignado || idAsignado === 'NUEVA') {
      idAsignado = generarIdCuenta();
      const nuevaCuenta = {
        id: idAsignado,
        nombre: val.nombre,
        descripcion: val.descripcion || 'Importada automáticamente de Budge',
        color: '#0ea5e9',
        dinero: val.saldo || 0,
        parentId: null,
        esSubcuenta: val.esSubcuenta || false,
        creadaEn: new Date().toISOString(),
        actualizadaEn: new Date().toISOString(),
        historial: [{ fecha: new Date().toISOString(), tipo: 'creacion', mensaje: 'Cuenta importada de Budge' }]
      };
      mapCuentasFinales.set(idAsignado, nuevaCuenta);
      nuevasCuentasAgregadas.push(nuevaCuenta);
    } else {
      // Es una cuenta existente. Si el CSV traía un saldo explícito, actualizarlo.
      if (val.saldo !== null && mapCuentasFinales.has(idAsignado)) {
        const cExist = mapCuentasFinales.get(idAsignado);
        cExist.dinero = val.saldo; // Actualiza el saldo en la cuenta combinada
        cExist.esSubcuenta = val.esSubcuenta;
      }
    }
    idCuentasResolver.set(key, idAsignado);
  }

  // Resolver Mapeos de Etiquetas
  const idEtiquetasResolver = new Map(); // key normalizada => ID local definitivo
  for (const [key, val] of analisisEtiquetasMap.entries()) {
    let idAsignado = mapeoEtiquetas[key];
    if (!idAsignado || idAsignado === 'NUEVA') {
      idAsignado = generarIdEtiqueta();
      const nuevaEti = {
        id: idAsignado, 
        nombre: val.nombre, 
        color: '#0ea5e9', 
        tipo: val.tipo,
        icono: '🏷️', 
        padreId: null, 
        creadaEn: new Date().toISOString(), 
        actualizadaEn: new Date().toISOString(), 
        historial: []
      };
      // Aquí se simplificó padre/hijo del CSV para forzarlas todas planas si son NUEVAS
      // debido a que Budge y la local difieren en arquitectura (una lista vs árbol)
      mapEtiquetasFinales.set(idAsignado, nuevaEti);
      nuevasEtiquetasAgregadas.push(nuevaEti);
    }
    idEtiquetasResolver.set(key, idAsignado);
  }

  const esOperacionDuplicada = (fechaYYYYMMDD, cantidad, tipo) => {
    return operacionesExistentes.some(op => {
      const opFechaStr = op.fecha.substring(0, 10);
      return opFechaStr === fechaYYYYMMDD && Math.abs(op.cantidad) === Math.abs(cantidad) && op.tipo === tipo;
    });
  };

  const nuevasOperaciones = [];
  for (const pair of transferenciasEmparejadas) {
    if (esOperacionDuplicada(pair.origenReg.fechaYYYYMMDD, Math.abs(pair.origenReg.cantidad), 'transferencia')) continue;
    
    const origenKey = normalizar(pair.origenReg.cuenta);
    const destinoKey = normalizar(pair.destinoReg.cuenta);
    
    nuevasOperaciones.push({
      id: generarIdOperacion(), 
      tipo: 'transferencia', 
      nombre: pair.origenReg.nombre || 'Transferencia', 
      descripcion: pair.origenReg.descripcion,
      cantidad: Math.abs(pair.origenReg.cantidad), 
      fecha: pair.origenReg.fechaISO, 
      origenId: idCuentasResolver.get(origenKey) || null, 
      destinoId: idCuentasResolver.get(destinoKey) || null, 
      estado: 'pagado', 
      creadaEn: new Date().toISOString()
    });
  }

  for (const reg of operacionesSueltas) {
    const esIngreso = reg.cantidad > 0;
    const tipo = esIngreso ? 'ingreso' : 'gasto';
    if (esOperacionDuplicada(reg.fechaYYYYMMDD, Math.abs(reg.cantidad), tipo)) continue;
    
    const cuentaKey = normalizar(reg.cuenta);
    const nombreEti = reg.categoriaHijo ? reg.categoriaHijo : reg.categoriaPadre;
    const etiquetaKey = normalizar(nombreEti);

    nuevasOperaciones.push({
      id: generarIdOperacion(), 
      tipo, 
      nombre: reg.nombre, 
      descripcion: reg.descripcion, 
      etiquetaId: idEtiquetasResolver.get(etiquetaKey) || null,
      cantidad: Math.abs(reg.cantidad), 
      fecha: reg.fechaISO, 
      cuentaId: idCuentasResolver.get(cuentaKey) || null, 
      estado: 'pagado', 
      creadaEn: new Date().toISOString()
    });
  }

  // Procesar Metas Simples
  const nuevasMetas = [];
  for (const mp of metasParseadas) {
    const duplicada = metasExistentes.some(m => m.tipo === 'simple' && normalizar(m.nombre) === normalizar(mp.nombre));
    if (duplicada) continue;

    const idCuentaEspejo = generarIdCuenta();
    const nuevaCuentaEspejo = {
      id: idCuentaEspejo,
      nombre: `Meta: ${mp.nombre}`,
      descripcion: mp.descripcion || 'Cuenta espejo para meta de Budge',
      color: '#f59e0b',
      dinero: mp.acumulado,
      parentId: null,
      esSubcuenta: true,
      creadaEn: new Date().toISOString(),
      actualizadaEn: new Date().toISOString(),
      historial: [{ fecha: new Date().toISOString(), tipo: 'creacion', mensaje: `Cuenta creada automáticamente por importación de meta.` }]
    };
    mapCuentasFinales.set(idCuentaEspejo, nuevaCuentaEspejo);
    nuevasCuentasAgregadas.push(nuevaCuentaEspejo);

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

  return { 
    requiereMapeo: false,
    cuentasFinales: Array.from(mapCuentasFinales.values()), 
    nuevasCuentasAgregadas, 
    etiquetasFinales: Array.from(mapEtiquetasFinales.values()),
    nuevasEtiquetasAgregadas, 
    nuevasOperaciones, 
    nuevasMetas,
    totalProcesadasCSV: registrosCSV.length 
  };
}
