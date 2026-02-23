/**
 * Document processing tools for the rental disputes agent
 * Simulates document upload and extraction capabilities
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';

type ContractValidationReasonCode =
  | 'VALID_CONTRACT'
  | 'VALID_WITH_WARNING'
  | 'INSUFFICIENT_TEXT'
  | 'AMBIGUOUS_EXTRACTION'
  | 'NO_LEGITIMACY_FIELDS_FOUND'
  | 'MISSING_ATTESTATION_MARK'
  | 'MISSING_ATTESTATION_NUMBER'
  | 'MISSING_CONTRACT_NUMBER'
  | 'MISSING_REQUIRED_CONTRACT_FIELDS'
  | 'MULTIPLE_MISSING_CRITICAL_FIELDS'
  | 'VALIDATION_ERROR';

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

const OFFICIAL_REFERENCE_NUMBER_PATTERN = /(?:رقم\s*(?:الطلب|العقد|التصديق|المرجع)|request\s*(?:number|no\.?)|application\s*(?:number|no\.?)|contract\s*(?:number|no\.?)|attestation\s*(?:number|no\.?)|document\s*(?:number|no\.?)|reference\s*(?:number|no\.?))\s*[:\-]?\s*([A-Z0-9\u0660-\u0669\/\-]{3,})/iu;
const GENERAL_DOC_CODE_PATTERN = /\b[A-Z]{2,5}-\d{2,6}(?:-\d{1,8})?\b|\b\d{2,4}-\d{3,10}\b/u;

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
  description: 'Validates whether a rental contract is legitimate using identifiers and attestation details found in the uploaded contract itself (no reference templates).',
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
      const formatHits = extractFormatMarkerHits(textContent);
      const formatHitCount = Object.values(formatHits).filter(Boolean).length;
      const documentAttestationSet = extractAttestationSet(textContent);
      const hasAttestationMark = ATTESTATION_MARKERS.stamp.test(textContent) || ATTESTATION_MARKERS.declaration.test(textContent);
      const hasExplicitAttestationNumber = /(attestation|attested|certification|تصديق|موثق|توثيق)\s*(number|no\.?|#|رقم)?\s*[:\-]?[\sA-Z0-9\u0660-\u0669\/\-]{3,}/iu.test(textContent);
      const hasExplicitContractNumber = /(contract|lease|tenancy|عقد|الإيجار)\s*(number|no\.?|#|رقم)?\s*[:\-]?[\sA-Z0-9\u0660-\u0669\/\-]{3,}/iu.test(textContent);
      const hasOfficialReferenceNumber = OFFICIAL_REFERENCE_NUMBER_PATTERN.test(textContent) || GENERAL_DOC_CODE_PATTERN.test(textContent);
      const hasAttestationNumber = hasExplicitAttestationNumber || (hasAttestationMark && hasOfficialReferenceNumber);
      const hasContractNumber = hasExplicitContractNumber || (/(contract|lease|tenancy|عقد|الإيجار)/iu.test(textContent) && hasOfficialReferenceNumber);
      const hasSignaturesOrWitness = documentAttestationSet.has('signatures') || documentAttestationSet.has('witnesses');
      const hasRequiredContractFields = formatHitCount >= 2;

      const criticalFieldStates = {
        attestationMark: hasAttestationMark,
        attestationNumber: hasAttestationNumber,
        contractNumber: hasContractNumber,
        requiredContractFields: hasRequiredContractFields
      };

      const presentCriticalCount = Object.values(criticalFieldStates).filter(Boolean).length;
      const totalCriticalCount = Object.keys(criticalFieldStates).length;
      const allCriticalPresent = presentCriticalCount === totalCriticalCount;
      const noCriticalPresent = presentCriticalCount === 0;
      const someCriticalMissing = presentCriticalCount > 0 && presentCriticalCount < totalCriticalCount;

      const missingCriticalItems: string[] = [];
      if (!hasAttestationMark) missingCriticalItems.push('attestationMark');
      if (!hasAttestationNumber) missingCriticalItems.push('attestationNumber');
      if (!hasContractNumber) missingCriticalItems.push('contractNumber');
      if (!hasRequiredContractFields) missingCriticalItems.push('requiredContractFields');

      let reasonCode: ContractValidationReasonCode = 'VALID_CONTRACT';
      if (allCriticalPresent) {
        reasonCode = 'VALID_CONTRACT';
      } else if (noCriticalPresent) {
        reasonCode = 'NO_LEGITIMACY_FIELDS_FOUND';
      } else if (someCriticalMissing && hasOfficialReferenceNumber) {
        reasonCode = 'VALID_WITH_WARNING';
      } else if (!hasAttestationMark) {
        reasonCode = 'MISSING_ATTESTATION_MARK';
      } else if (!hasAttestationNumber && !hasContractNumber) {
        reasonCode = 'MULTIPLE_MISSING_CRITICAL_FIELDS';
      } else if (!hasAttestationNumber) {
        reasonCode = 'MISSING_ATTESTATION_NUMBER';
      } else if (!hasContractNumber) {
        reasonCode = 'MISSING_CONTRACT_NUMBER';
      } else if (!hasRequiredContractFields) {
        reasonCode = 'MISSING_REQUIRED_CONTRACT_FIELDS';
      }

      const isLegitContract = reasonCode === 'VALID_CONTRACT' || reasonCode === 'VALID_WITH_WARNING';

      const missingFormatItems = Object.entries(formatHits)
        .filter(([, found]) => !found)
        .map(([key]) => key);

      const resultMessage = isLegitContract
        ? reasonCode === 'VALID_WITH_WARNING'
          ? 'Contract is treated as legitimate based on official references, but some required legitimacy fields are missing and should be provided for court acceptance.'
          : 'Contract appears legitimate based on attestation details, identifiers, and required contract fields found in the uploaded document.'
        : 'Contract legitimacy check failed because one or more required contract legitimacy indicators were not found in the uploaded document.';

      return {
        status: isLegitContract ? 'success' : 'failed',
        fileName: fileName || null,
        isLegitContract,
        reasonCode,
        legitimacyStatus: reasonCode === 'VALID_CONTRACT'
          ? 'STRAIGHT_LEGIT'
          : reasonCode === 'VALID_WITH_WARNING'
            ? 'LEGIT_WITH_WARNING'
            : 'INVALID',
        warning: reasonCode === 'VALID_WITH_WARNING'
          ? 'Some required contract fields are missing. Please provide the missing fields because the court may require them to accept the contract.'
          : null,
        checks: {
          hasAttestationMark,
          hasAttestationNumber,
          hasContractNumber,
          hasOfficialReferenceNumber,
          hasSignaturesOrWitness,
          hasRequiredContractFields
        },
        findings: {
          detectedFormatMarkers: formatHits,
          missingFormatItems,
          documentAttestationMarkers: Array.from(documentAttestationSet),
          missingCriticalItems
        },
        message: resultMessage
      };
    } catch (error) {
      return {
        status: 'failed',
        isLegitContract: false,
        reasonCode: 'VALIDATION_ERROR' satisfies ContractValidationReasonCode,
        reason: `Unable to complete contract legitimacy verification: ${(error as Error).message}`
      };
    }
  }
});
