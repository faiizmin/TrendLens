const lines = ['Assembly A', 'Assembly B', 'CNC Cell', 'Packaging'];
const products = ['AeroValve X2', 'Flow Sensor M1', 'Control Unit 8', 'Drive Housing'];

// Synthetic starter records. Replace this module with a CSV/database adapter later.
export const productionData = Array.from({ length: 56 }, (_, index) => {
  const day = new Date(2026, 9, 11 - (55 - index));
  const lineIndex = (index * 3 + Math.floor(index / 4)) % lines.length;
  const productIndex = (index + Math.floor(index / 3)) % products.length;
  const target = [480, 420, 360, 520][lineIndex];
  const wave = Math.sin(index * 0.61 + lineIndex) * 34 + Math.cos(index * 0.19) * 16;
  const actual = Math.max(245, Math.round(target + wave - (index % 9 === 0 ? 62 : 0)));
  const downtime = Math.max(0, Math.round(18 + Math.abs(Math.sin(index * 0.77 + lineIndex)) * 68 + (index % 13 === 0 ? 34 : 0)));
  const defects = Math.max(1, Math.round(actual * (0.012 + ((index * 7) % 17) / 1000)));
  return {
    id: index + 1,
    date: day.toISOString().slice(0, 10),
    line: lines[lineIndex],
    product: products[productIndex],
    target,
    actual,
    downtime,
    defects,
  };
});

export const productionLines = lines;
export const productNames = products;
