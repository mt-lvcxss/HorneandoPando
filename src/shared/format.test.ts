import { describe, expect, it } from 'vitest';
import { formatCLP, formatDate, formatQuantity, parseCLP, parseDecimal, quantityToInput } from './format';

describe('parseDecimal', () => {
  it('acepta coma o punto decimal', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal(' 0,125 ')).toBe(0.125);
  });

  it('interpreta el punto de miles chileno', () => {
    expect(parseDecimal('1.000')).toBe(1000);
    expect(parseDecimal('1.000,5')).toBe(1000.5);
    expect(parseDecimal('25.000.000')).toBe(25_000_000);
  });

  it('rechaza textos vacíos o inválidos', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('2,5,1')).toBeNull();
  });
});

describe('parseCLP', () => {
  it('lee pesos enteros con o sin formato', () => {
    expect(parseCLP('$18.990')).toBe(18990);
    expect(parseCLP('18990')).toBe(18990);
  });

  it('rechaza decimales y textos inválidos', () => {
    expect(parseCLP('18990,5')).toBeNull();
    expect(parseCLP('')).toBeNull();
    expect(parseCLP('-5')).toBeNull();
  });
});

describe('formato', () => {
  it('muestra cantidades sin redondear a entero', () => {
    expect(formatQuantity(2.5)).toBe('2,5');
    expect(formatQuantity(25000)).toBe('25.000');
    expect(formatQuantity(null)).toBe('—');
  });

  it('nunca muestra un importe desconocido como $0', () => {
    expect(formatCLP(null)).toBe('Sin dato');
    expect(formatCLP(18990)).toMatch(/18\.990/);
  });

  it('prepara cantidades para editar y fechas sin desfase de zona', () => {
    expect(quantityToInput(2.5)).toBe('2,5');
    expect(formatDate('2026-10-30')).toBe('30-10-2026');
  });
});
