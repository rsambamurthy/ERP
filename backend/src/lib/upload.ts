import multer from "multer";

// In-memory storage — files are parsed straight out of req.file.buffer and
// never written to disk. 5MB is generous for a spreadsheet of master data.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
