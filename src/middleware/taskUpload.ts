import multer from 'multer';

// Deliverable attachments from mentor when creating a task (PDF, DOC, DOCX, etc.)
export const uploadTaskAttachments = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 5,
  },
}).array('attachments', 5);

// Attachment from mentee when submitting a task (file, zip, document, screenshot)
export const uploadSubmissionAttachment = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 1,
  },
}).single('attachment');

