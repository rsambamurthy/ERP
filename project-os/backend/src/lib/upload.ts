import multer from "multer";

// In-memory storage — files are parsed straight out of req.file.buffer and
// never written to disk. Same convention as SmartERP's own lib/upload.ts.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
