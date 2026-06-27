import * as fs from 'fs';
import * as path from 'path';

/** Extracts plain text from a file based on its extension. */
export async function extractText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        return extractPdf(filePath);
    }
    if (ext === '.docx') {
        return extractDocx(filePath);
    }
    // Plain text, markdown, code files
    return fs.promises.readFile(filePath, 'utf-8');
}

async function extractPdf(filePath: string): Promise<string> {
    // pdf-parse is a CommonJS module
     
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const buf = await fs.promises.readFile(filePath);
    const result = await pdfParse(buf);
    return result.text;
}

async function extractDocx(filePath: string): Promise<string> {
     
    const mammoth = require('mammoth') as {
        extractRawText(opts: { path: string }): Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}
