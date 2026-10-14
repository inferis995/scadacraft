// Minimal Modbus TCP slave used by the tests (a "PLC" for ScadaCraft to poll).
//   40001-40002  Float32 (big-endian) tank level, %
//   30001        Int16 flow ×10 (m3/h)
//   00001        pump running feedback
//   00002        pump start/stop command (written by ScadaCraft)
import ModbusRTU from 'modbus-serial';

export function startModbusSim({ host = '127.0.0.1', port = 5020, unitID = 1 } = {}) {
  const holding = new Array(100).fill(0);
  const input = new Array(100).fill(0);
  const coils = new Array(100).fill(false);
  const writes = [];

  const setFloat = (reg, v) => {
    const b = Buffer.alloc(4);
    b.writeFloatBE(v);
    holding[reg] = b.readUInt16BE(0);
    holding[reg + 1] = b.readUInt16BE(2);
  };

  const vector = {
    getHoldingRegister: (addr) => holding[addr] ?? 0,
    getInputRegister: (addr) => input[addr] ?? 0,
    getCoil: (addr) => coils[addr] ?? false,
    getDiscreteInput: (addr) => coils[addr] ?? false,
    setRegister: (addr, value) => { holding[addr] = value; writes.push({ area: 'hr', addr, value }); },
    setCoil: (addr, value) => { coils[addr] = value; writes.push({ area: 'coil', addr, value }); },
  };
  const server = new ModbusRTU.ServerTCP(vector, { host, port, unitID, debug: false });
  return {
    server, coils, input, writes,
    setLevel: (v) => setFloat(0, v),
    setFlow: (v) => { input[0] = Math.round(v * 10); },
    setRunning: (v) => { coils[0] = v; },
    close: () => new Promise((r) => server.close(r)),
  };
}
