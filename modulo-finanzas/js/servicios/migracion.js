function generarIdCuenta() { return 'cta_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function generarIdEtiqueta() { return 'tag_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function generarIdOperacion() { return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

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

export function procesarCSVBudge(contenidoCSV, cuentasExistentes = [], etiquetasExistentes = [], operacionesExistentes = []) {
  const lineas = contenidoCSV.split('\n');
  let iniciandoDatos = false;
  
  const registrosCSV = [];
  
  for (let linea of lineas) {
    linea = linea.trim();
    if (!linea) continue;
    if (linea.startsWith('Date,Payment,Is paid,Amount,Currency,Account,Category,Subcategory,Goal,Description')) {
      iniciandoDatos = true;
      continue;
    }
    if (!iniciandoDatos) continue;
    
    const valores = parsearLineaCSV(linea);
    if (valores.length < 10) continue;
    
    let [DateStr, Payment, IsPaid, AmountStr, Currency, Account, Category, Subcategory, Goal, Description] = valores;
    
    // Parsear fecha DD-MM-YYYY a YYYY-MM-DD
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

  // 1. Identificar y agrupar transferencias
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
  // Intentar emparejar
  for (let i = 0; i < transferenciasOut.length; i++) {
    const outReg = transferenciasOut[i];
    if (outReg.emparejado) continue;
    
    // Buscar In correspondiente
    const inIdx = transferenciasIn.findIndex(inReg => 
      !inReg.emparejado && 
      inReg.fechaYYYYMMDD === outReg.fechaYYYYMMDD && 
      Math.abs(inReg.cantidad) === Math.abs(outReg.cantidad)
    );
    
    if (inIdx !== -1) {
      const inReg = transferenciasIn[inIdx];
      outReg.emparejado = true;
      inReg.emparejado = true;
      transferenciasEmparejadas.push({
        origenReg: outReg,
        destinoReg: inReg
      });
    } else {
      operacionesSueltas.push(outReg);
    }
  }
  
  for (const inReg of transferenciasIn) {
    if (!inReg.emparejado) operacionesSueltas.push(inReg);
  }

  const mapCuentas = new Map();
  for (const c of cuentasExistentes) mapCuentas.set(c.nombre.toLowerCase(), c.id);

  const mapEtiquetas = new Map();
  for (const e of etiquetasExistentes) mapEtiquetas.set(e.nombre.toLowerCase(), e.id);

  const nuevasCuentas = [];
  const nuevasEtiquetas = [];
  const nuevasOperaciones = [];

  const obtenerIdCuenta = (nombre) => {
    if (!nombre) return null;
    const nameLower = nombre.toLowerCase();
    if (mapCuentas.has(nameLower)) return mapCuentas.get(nameLower);
    const id = generarIdCuenta();
    mapCuentas.set(nameLower, id);
    nuevasCuentas.push({
      id, nombre, descripcion: 'Importada de Budge', color: '#0ea5e9', dinero: 0,
      parentId: null, esSubcuenta: false, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
    });
    return id;
  };

  const obtenerIdEtiqueta = (padre, hijo, esIngreso) => {
    const nombreReal = hijo ? hijo : padre;
    if (!nombreReal) return null;
    const nameLower = nombreReal.toLowerCase();
    
    if (mapEtiquetas.has(nameLower)) return mapEtiquetas.get(nameLower);
    
    let padreId = null;
    if (padre && hijo) {
      const padreLower = padre.toLowerCase();
      if (mapEtiquetas.has(padreLower)) {
        padreId = mapEtiquetas.get(padreLower);
      } else {
        padreId = generarIdEtiqueta();
        mapEtiquetas.set(padreLower, padreId);
        nuevasEtiquetas.push({
          id: padreId, nombre: padre, color: '#0ea5e9', tipo: esIngreso ? 'ingreso' : 'gasto',
          icono: '🏷️', padreId: null, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
        });
      }
    }
    
    const id = generarIdEtiqueta();
    mapEtiquetas.set(nameLower, id);
    nuevasEtiquetas.push({
      id, nombre: nombreReal, color: '#0ea5e9', tipo: esIngreso ? 'ingreso' : 'gasto',
      icono: '🏷️', padreId, creadaEn: new Date().toISOString(), actualizadaEn: new Date().toISOString(), historial: []
    });
    return id;
  };

  const esOperacionDuplicada = (fechaYYYYMMDD, cantidad, tipo) => {
    return operacionesExistentes.some(op => {
      const opFechaStr = op.fecha.substring(0, 10);
      return opFechaStr === fechaYYYYMMDD && Math.abs(op.cantidad) === Math.abs(cantidad) && op.tipo === tipo;
    });
  };

  for (const pair of transferenciasEmparejadas) {
    if (esOperacionDuplicada(pair.origenReg.fechaYYYYMMDD, Math.abs(pair.origenReg.cantidad), 'transferencia')) {
      continue;
    }
    const origenId = obtenerIdCuenta(pair.origenReg.cuenta);
    const destinoId = obtenerIdCuenta(pair.destinoReg.cuenta);
    
    nuevasOperaciones.push({
      id: generarIdOperacion(),
      tipo: 'transferencia',
      nombre: pair.origenReg.nombre || 'Transferencia',
      descripcion: pair.origenReg.descripcion,
      cantidad: Math.abs(pair.origenReg.cantidad),
      fecha: pair.origenReg.fechaISO,
      origenId,
      destinoId,
      estado: 'pagado',
      creadaEn: new Date().toISOString()
    });
  }

  for (const reg of operacionesSueltas) {
    const esIngreso = reg.cantidad > 0;
    const tipo = esIngreso ? 'ingreso' : 'gasto';
    
    if (esOperacionDuplicada(reg.fechaYYYYMMDD, Math.abs(reg.cantidad), tipo)) {
      continue;
    }

    const cuentaId = obtenerIdCuenta(reg.cuenta);
    const etiquetaId = obtenerIdEtiqueta(reg.categoriaPadre, reg.categoriaHijo, esIngreso);

    nuevasOperaciones.push({
      id: generarIdOperacion(),
      tipo,
      nombre: reg.nombre,
      descripcion: reg.descripcion,
      etiquetaId,
      cantidad: Math.abs(reg.cantidad),
      fecha: reg.fechaISO,
      cuentaId,
      estado: 'pagado',
      creadaEn: new Date().toISOString()
    });
  }

  return { nuevasCuentas, nuevasEtiquetas, nuevasOperaciones, totalProcesadasCSV: registrosCSV.length };
}
