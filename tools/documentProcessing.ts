/**
 * Document processing tools for the rental disputes agent
 * Simulates document upload and extraction capabilities
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';

type ContractTemplateType = 'commercial' | 'residential';

type ContractValidationReasonCode =
  | 'VALID_CONTRACT'
  | 'INSUFFICIENT_TEXT'
  | 'REFERENCE_UNAVAILABLE'
  | 'FORMAT_MISMATCH'
  | 'ATTESTATION_MISMATCH'
  | 'FORMAT_AND_ATTESTATION_MISMATCH'
  | 'VALIDATION_ERROR';

type TemplateProfile = {
  type: ContractTemplateType;
  text: string;
  normalizedText: string;
  tokenSet: Set<string>;
  attestationSet: Set<string>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_FILE_NAMES: Record<ContractTemplateType, string> = {
  commercial: 'commercial contract.pdf',
  residential: 'Residential contract.pdf'
};

const EN_STOPWORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'been',
  'shall', 'will', 'have', 'has', 'had', 'not', 'you', 'your', 'their', 'its', 'into', 'upon',
  'about', 'between', 'under', 'over', 'there', 'here', 'than', 'then', 'such'
]);

const AR_STOPWORDS = new Set([
  'من', 'في', 'على', 'الى', 'إلى', 'عن', 'هذا', 'هذه', 'ذلك', 'تلك', 'كما', 'وقد', 'و', 'مع',
  'تم', 'لدى', 'حسب', 'بعد', 'قبل', 'او', 'أو', 'أن', 'إن', 'ما', 'لا', 'لم', 'لن', 'هو', 'هي'
]);

const FORMAT_MARKERS = {
  parties: /landlord|tenant|lessor|lessee|مالك|مؤجر|مستأجر|طرف/i,
  property: /property|premises|address|unit|عنوان|العقار|الوحدة|العين المؤجرة/i,
  rent: /rent|rental|amount|payment|currency|إيجار|قيمة|مبلغ|بدل الإيجار|الأجرة/i,
  duration: /term|duration|period|month|year|مدة|فترة|شهر|سنة|سنوات/i,
  dates: /date|commencement|expiry|start|end|تاريخ|بداية|نهاية|انتهاء/i,
  obligations: /obligation|condition|clause|article|شرط|بند|التزام|المادة/i
} as const;

const ATTESTATION_MARKERS = {
  signatures: /signature|sign|signed|توقيع|موقع|التوقيع/i,
  witnesses: /witness|witnesses|شاهد|شهود/i,
  stamp: /stamp|seal|official|ختم|مصدق|التصديق/i,
  declaration: /attest|attestation|declare|declaration|إقرار|يشهد|شهادة/i,
  idProof: /id|identity|passport|emirates id|هوية|بطاقة|جواز/i
} as const;

let cachedTemplatesPromise: Promise<TemplateProfile[]> | null = null;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTemplateFilePath(fileName: string): Promise<string | null> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'contract reference', fileName),
    path.resolve(__dirname, '../contract reference', fileName),
    path.resolve(__dirname, '../../contract reference', fileName)
  ];

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function tokenize(input: string): Set<string> {
  const normalized = normalizeText(input);
  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !EN_STOPWORDS.has(token) && !AR_STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccardSimilarity(first: Set<string>, second: Set<string>): number {
  if (first.size === 0 || second.size === 0) return 0;

  let intersection = 0;
  for (const token of first) {
    if (second.has(token)) intersection += 1;
  }
  const union = first.size + second.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractFormatMarkerHits(text: string): Record<string, boolean> {
  return {
    parties: FORMAT_MARKERS.parties.test(text),
    property: FORMAT_MARKERS.property.test(text),
    rent: FORMAT_MARKERS.rent.test(text),
    duration: FORMAT_MARKERS.duration.test(text),
    dates: FORMAT_MARKERS.dates.test(text),
    obligations: FORMAT_MARKERS.obligations.test(text)
  };
}

function extractAttestationSet(text: string): Set<string> {
  const set = new Set<string>();
  if (ATTESTATION_MARKERS.signatures.test(text)) set.add('signatures');
  if (ATTESTATION_MARKERS.witnesses.test(text)) set.add('witnesses');
  if (ATTESTATION_MARKERS.stamp.test(text)) set.add('stamp');
  if (ATTESTATION_MARKERS.declaration.test(text)) set.add('declaration');
  if (ATTESTATION_MARKERS.idProof.test(text)) set.add('idProof');
  return set;
}

async function loadTemplateProfiles(): Promise<TemplateProfile[]> {
  if (cachedTemplatesPromise) return cachedTemplatesPromise;

  cachedTemplatesPromise = (async () => {
    const resolvedFiles = await Promise.all(
      Object.entries(TEMPLATE_FILE_NAMES).map(async ([type, fileName]) => {
        const resolvedPath = await resolveTemplateFilePath(fileName);
        return {
          type: type as ContractTemplateType,
          resolvedPath
        };
      })
    );

    const missingTemplates = resolvedFiles
      .filter((entry) => !entry.resolvedPath)
      .map((entry) => entry.type);

    if (missingTemplates.length > 0) {
      throw new Error(`REFERENCE_TEMPLATE_MISSING:${missingTemplates.join(',')}`);
    }

    const entries = await Promise.all(
      resolvedFiles.map(async ({ type, resolvedPath }) => {
        const absolutePath = resolvedPath as string;
        const buffer = await fs.readFile(absolutePath);
        const parsed = await pdfParse(buffer);
        const text = parsed.text || '';
        const normalizedText = normalizeText(text);
        const tokenSet = tokenize(text);
        const attestationSet = extractAttestationSet(text);

        return {
          type: type as ContractTemplateType,
          text,
          normalizedText,
          tokenSet,
          attestationSet
        } satisfies TemplateProfile;
      })
    );

    return entries;
  })().catch((error) => {
    cachedTemplatesPromise = null;
    throw error;
  });

  return cachedTemplatesPromise;
}

/**
 * Tool for uploading and processing documents
 * In production, this would integrate with actual file upload/OCR services
 */
export const uploadDocumentTool = new FunctionTool({
  name: 'upload_document',
  description: 'Simulates uploading a document (rental contract, statement of claim, or supporting document). In production, this would handle actual file uploads.',
  parameters: z.object({
    documentType: z.enum(['rental_contract', 'statement_of_claim', 'supporting_document'])
      .describe('The type of document being uploaded'),
    fileName: z.string().describe('The name of the document file'),
    contentSummary: z.string().describe('A brief description of what the document contains (user provides this)')
  }),
  execute: ({ documentType, fileName, contentSummary }) => {
    return {
      status: 'success',
      uploadedDocument: {
        type: documentType,
        fileName: fileName,
        summary: contentSummary,
        uploadedAt: new Date().toISOString()
      },
      message: `Document "${fileName}" of type "${documentType}" has been uploaded successfully.`
    };
  }
});

/**
 * Tool for extracting text from documents
 * This would use OCR/PDF parsing in production
 */
export const extractDocumentTextTool = new FunctionTool({
  name: 'extract_document_text',
  description: 'Extracts and analyzes text from an uploaded document. Returns key legal information found in the document.',
  parameters: z.object({
    documentType: z.enum(['rental_contract', 'statement_of_claim', 'supporting_document'])
      .describe('The type of document to extract from'),
    textContent: z.string().describe('The actual text content of the document (in production, this would be OCR output)')
  }),
  execute: ({ documentType, textContent }) => {
    // Simple keyword extraction (in production, this would use NLP)
    const extractedData: any = {
      documentType,
      language: /[\u0600-\u06FF]/.test(textContent) ? 'ar' : 'en',
      contentLength: textContent.length
    };
    
    // Extract key information based on document type
    if (documentType === 'rental_contract') {
      extractedData.findings = {
        hasPartyNames: /landlord|tenant|مالك|مستأجر/i.test(textContent),
        hasPropertyAddress: /address|property|عنوان|عقار/i.test(textContent),
        hasRentAmount: /rent|amount|payment|إيجار|مبلغ|دفع/i.test(textContent),
        hasDuration: /month|year|duration|period|شهر|سنة|مدة/i.test(textContent)
      };
    } else if (documentType === 'statement_of_claim') {
      extractedData.findings = {
        hasClaimDescription: textContent.length > 50,
        hasDisputeType: true,
        textPreview: textContent.substring(0, 200)
      };
    }
    
    return {
      status: 'success',
      extractedData,
      message: `Successfully extracted data from ${documentType}`
    };
  }
});

/**
 * Tool for confirming extracted data
 */
export const confirmExtractedDataTool = new FunctionTool({
  name: 'confirm_extracted_data',
  description: 'Allows the user to confirm or correct the automatically extracted data.',
  parameters: z.object({
    confirmed: z.boolean().describe('Whether the user confirms the extracted data is correct'),
    corrections: z.string().optional().describe('Any corrections the user wants to make')
  }),
  execute: ({ confirmed, corrections }) => {
    if (!confirmed) {
      return {
        status: 'failed',
        message: 'Unable to verify due to missing or unclear documents. User could not confirm extracted data.',
        corrections: corrections || 'No corrections provided'
      };
    }
    
    return {
      status: 'success',
      message: 'User confirmed the extracted data is correct.',
      corrections: corrections || 'None'
    };
  }
});

/**
 * Tool for validating whether an uploaded rental contract is legitimate.
 * The uploaded contract must resemble one of the official reference templates
 * (commercial or residential) in format and attestation indicators.
 */
export const validateContractLegitimacyTool = new FunctionTool({
  name: 'validate_contract_legitimacy',
  description: 'Validates whether a rental contract is legitimate by comparing it against reference commercial/residential contract templates and checking attestation similarity.',
  parameters: z.object({
    textContent: z.string().describe('Full extracted text of the uploaded rental contract'),
    fileName: z.string().optional().describe('Optional uploaded file name for reporting')
  }),
  execute: async ({ textContent, fileName }) => {
    const normalizedDocumentText = normalizeText(textContent || '');
    if (!normalizedDocumentText || normalizedDocumentText.length < 120) {
      return {
        status: 'failed',
        isLegitContract: false,
        reasonCode: 'INSUFFICIENT_TEXT' satisfies ContractValidationReasonCode,
        reason: 'Insufficient extracted text to verify contract format and attestation.'
      };
    }

    try {
      const templates = await loadTemplateProfiles();
      if (templates.length === 0) {
        return {
          status: 'failed',
          isLegitContract: false,
          reasonCode: 'REFERENCE_UNAVAILABLE' satisfies ContractValidationReasonCode,
          reason: 'Reference contract templates are unavailable for verification.'
        };
      }

      const documentTokenSet = tokenize(textContent);
      const formatHits = extractFormatMarkerHits(textContent);
      const formatHitCount = Object.values(formatHits).filter(Boolean).length;
      const formatCoverage = formatHitCount / Object.keys(formatHits).length;
      const documentAttestationSet = extractAttestationSet(textContent);

      const perTemplate = templates.map((template) => {
        const lexicalSimilarity = jaccardSimilarity(documentTokenSet, template.tokenSet);
        const attestationSimilarity = jaccardSimilarity(documentAttestationSet, template.attestationSet);
        const combinedSimilarity = (lexicalSimilarity * 0.7) + (formatCoverage * 0.2) + (attestationSimilarity * 0.1);

        return {
          templateType: template.type,
          lexicalSimilarity,
          attestationSimilarity,
          combinedSimilarity,
          templateAttestationMarkers: Array.from(template.attestationSet)
        };
      });

      const bestMatch = perTemplate.sort((a, b) => b.combinedSimilarity - a.combinedSimilarity)[0];

      const hasSimilarFormat = formatHitCount >= 4 && bestMatch.lexicalSimilarity >= 0.08;
      const hasSimilarAttestation = documentAttestationSet.size >= 2 && bestMatch.attestationSimilarity >= 0.34;
      const isLegitContract = hasSimilarFormat && hasSimilarAttestation;

      let reasonCode: ContractValidationReasonCode = 'VALID_CONTRACT';
      if (!isLegitContract) {
        if (!hasSimilarFormat && !hasSimilarAttestation) {
          reasonCode = 'FORMAT_AND_ATTESTATION_MISMATCH';
        } else if (!hasSimilarFormat) {
          reasonCode = 'FORMAT_MISMATCH';
        } else if (!hasSimilarAttestation) {
          reasonCode = 'ATTESTATION_MISMATCH';
        }
      }

      const missingFormatItems = Object.entries(formatHits)
        .filter(([, found]) => !found)
        .map(([key]) => key);

      const resultMessage = isLegitContract
        ? `Contract appears legitimate and is similar to the ${bestMatch.templateType} reference format and attestation.`
        : 'Contract legitimacy check failed: format and/or attestation does not sufficiently match reference templates.';

      return {
        status: isLegitContract ? 'success' : 'failed',
        fileName: fileName || null,
        isLegitContract,
        reasonCode,
        matchedTemplateType: bestMatch.templateType,
        checks: {
          hasSimilarFormat,
          hasSimilarAttestation,
          formatCoverage,
          lexicalSimilarity: bestMatch.lexicalSimilarity,
          attestationSimilarity: bestMatch.attestationSimilarity
        },
        findings: {
          detectedFormatMarkers: formatHits,
          missingFormatItems,
          documentAttestationMarkers: Array.from(documentAttestationSet),
          referenceAttestationMarkers: bestMatch.templateAttestationMarkers
        },
        message: resultMessage
      };
    } catch (error) {
      const errorMessage = (error as Error).message || '';
      const isReferenceError = errorMessage.startsWith('REFERENCE_TEMPLATE_MISSING:');

      return {
        status: 'failed',
        isLegitContract: false,
        reasonCode: isReferenceError
          ? ('REFERENCE_UNAVAILABLE' satisfies ContractValidationReasonCode)
          : ('VALIDATION_ERROR' satisfies ContractValidationReasonCode),
        reason: isReferenceError
          ? 'Reference contract templates are unavailable for verification.'
          : `Unable to complete template-based contract legitimacy verification: ${(error as Error).message}`
      };
    }
  }
});
