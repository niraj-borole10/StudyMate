import mongoose from "mongoose";

const AssignmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  emailId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Email"
  },
  title: {
    type: String,
    required: true
  },
  deadline: {
    type: Date,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["todo", "progress", "completed"],
    default: "todo"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Assignment = mongoose.model("Assignment", AssignmentSchema);
export default Assignment;
