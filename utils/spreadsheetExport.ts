function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toXlsFileName(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, '.xls');
}

/**
 * SpreadsheetML (.xls) — opens in Excel/LibreOffice without the vulnerable `xlsx` package
 * or the heavy `exceljs` bundle.
 */
export async function downloadRowsAsXlsx(
  rows: Record<string, unknown>[],
  sheetName: string,
  fileName: string
): Promise<void> {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerRow = headers
    .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('');
  const dataRows = rows
    .map((row) => {
      const cells = headers
        .map((key) => {
          const value = row[key];
          const isNum = typeof value === 'number' && Number.isFinite(value);
          const type = isNum ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${escapeXml(sheetName.slice(0, 31))}">
    <Table>
      <Row>${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  downloadBlob(
    new Blob(['\ufeff' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
    toXlsFileName(fileName)
  );
}

export function downloadRowsAsCsv(rows: Record<string, unknown>[], fileName: string): void {
  if (rows.length === 0) {
    downloadBlob(new Blob(['\ufeff'], { type: 'text/csv;charset=utf-8;' }), fileName);
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((key) => escapeCsvCell(row[key])).join(','))
  ];
  downloadBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), fileName);
}
