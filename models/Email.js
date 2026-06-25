import mongoose from "mongoose";

const EmailSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  emailId: {
    type: String,
    required: true,
    unique: true
  },
  sender: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  date: {
    type: String
  },
  body: {
    type: String
  },
  parsedStatus: {
    type: String,
    enum: ["UNPROCESSED", "PROCESSED", "FAILED"],
    default: "UNPROCESSED"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Email = mongoose.model("Email", EmailSchema);
export default Email;
