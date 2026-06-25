import mongoose from "mongoose";

const ScheduleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  subjects: [{
    type: String
  }],
  hoursPerDay: {
    type: Number,
    required: true
  },
  scheduleData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Schedule = mongoose.model("Schedule", ScheduleSchema);
export default Schedule;
