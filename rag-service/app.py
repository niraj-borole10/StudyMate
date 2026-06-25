import os
import io
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from pydantic import BaseModel
from dotenv import load_dotenv
import pypdf
import chromadb
import google.generativeai as genai

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI(title="StudyMate RAG Service")

# Configure Google Gemini API Key
api_key = os.getenv("GEMINI_API_KEY")
if not api_key or api_key == "your_gemini_api_key_here":
    print("⚠️ Warning: GEMINI_API_KEY environment variable is missing or default. RAG service API operations will fail.")
else:
    genai.configure(api_key=api_key)

# Initialize ChromaDB Local Vector Store
CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

def get_user_collection(user_id: str = None):
    collection_name = f"user_{user_id}" if user_id else "student_notes"
    return chroma_client.get_or_create_collection(name=collection_name)

class QueryRequest(BaseModel):
  question: str
  user_id: str = None

# Helper to split text into overlapping chunks
def chunk_text(text: str, chunk_size: int = 800, overlap: int = 150):
  chunks = []
  start = 0
  while start < len(text):
    end = start + chunk_size
    chunks.append(text[start:end])
    start += chunk_size - overlap
  return chunks

# Helper to get Google Embeddings for documents/queries
def get_embedding(text: str, is_query: bool = False):
  task = "retrieval_query" if is_query else "retrieval_document"
  result = genai.embed_content(
      model="models/gemini-embedding-001",
      content=text,
      task_type=task
  )
  return result["embedding"]

@app.post("/ingest")
async def ingest_document(file: UploadFile = File(...), user_id: str = Form(None)):
  try:
    user_collection = get_user_collection(user_id)
    content_bytes = await file.read()
    text = ""
    
    # 1. Parse File Content
    if file.filename.endswith(".pdf"):
      pdf_file = io.BytesIO(content_bytes)
      reader = pypdf.PdfReader(pdf_file)
      for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
          text += page_text + "\n"
    elif file.filename.endswith(".txt"):
      text = content_bytes.decode("utf-8", errors="ignore")
    else:
      raise HTTPException(status_code=400, detail="Unsupported file format. Only PDF and TXT files are accepted.")
    
    if not text.strip():
      raise HTTPException(status_code=400, detail="The uploaded document contains no readable text.")

    # 2. Chunking
    chunks = chunk_text(text)
    print(f"Ingesting '{file.filename}': Split into {len(chunks)} chunks.")

    # 3. Compute Embeddings & Load to ChromaDB
    embeddings = []
    documents = []
    ids = []
    metadatas = []

    for i, chunk in enumerate(chunks):
      # Skip empty chunks
      if not chunk.strip():
        continue
        
      try:
        emb = get_embedding(chunk, is_query=False)
        embeddings.append(emb)
        documents.append(chunk)
        ids.append(f"{file.filename}_{i}_{hash(chunk) % 10000}")
        metadatas.append({"filename": file.filename})
      except Exception as emb_err:
        print(f"Failed to generate embedding for chunk {i}: {emb_err}")
        continue

    if documents:
      user_collection.add(
          embeddings=embeddings,
          documents=documents,
          metadatas=metadatas,
          ids=ids
      )
      return {"filename": file.filename, "chunks_added": len(documents), "status": "success"}
    else:
      raise HTTPException(status_code=500, detail="Failed to generate embeddings for any chunks.")

  except Exception as e:
    print(f"Ingestion error for {file.filename}: {e}")
    raise HTTPException(status_code=500, detail=str(e))

@app.get("/count")
async def get_document_count(user_id: str = None):
  try:
    user_collection = get_user_collection(user_id)
    data = user_collection.get(include=["metadatas"])
    metadatas = data.get("metadatas", [])
    filenames = list(set([m["filename"] for m in metadatas if m and "filename" in m]))
    return {"count": len(filenames), "files": filenames}
  except Exception as e:
    print(f"Count error: {e}")
    return {"count": 0, "files": []}

@app.post("/query")
async def query_notes(request: QueryRequest):
  question = request.question
  user_id = request.user_id
  
  try:
    user_collection = get_user_collection(user_id)
    # 1. Check if vector DB has documents loaded
    count = user_collection.count()
    if count == 0:
      return {
        "answer": "No study materials have been synced yet. Please click 'Sync Drive Files' in your dashboard to fetch notes.",
        "sources": []
      }

    # 2. Get Query Embedding
    query_emb = get_embedding(question, is_query=True)

    # 3. Query Vector Store for top 4 matches
    search_results = user_collection.query(
        query_embeddings=[query_emb],
        n_results=4
    )

    retrieved_chunks = search_results["documents"][0]
    metadata_records = search_results["metadatas"][0]
    
    if not retrieved_chunks:
      return {
        "answer": "I couldn't find any relevant study materials in your files matching that question.",
        "sources": []
      }

    # 4. Formulate Gemini RAG Context
    context_str = "\n---\n".join(retrieved_chunks)
    
    prompt = f"""
      You are an advanced academic tutor helping a student study their courses.
      Answer the student's question utilizing the notes context chunks retrieved from their Google Drive files.
      
      Requirements:
      1. Provide a detailed, clean, and helpful response.
      2. Rely strictly on the context below. If the answer cannot be found in the context, clearly tell the user "I couldn't find the exact answer in your notes, but based on typical course material..." and then provide a general explanation.
      3. Do not mention "based on the context provided" or similar phrases; answer naturally.

      Retrieved Notes Context:
      -----------------------
      {context_str}
      -----------------------

      Student Question: {question}
    """

    model = genai.GenerativeModel("gemini-2.5-flash")
    result = model.generate_content(prompt)
    answer = result.text

    # Extract unique source names
    sources = list(set([m["filename"] for m in metadata_records]))

    return {
      "answer": answer,
      "sources": sources
    }

  except Exception as e:
    print(f"RAG query error: {e}")
    raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
  # Run fastapi service on port 8001
  uvicorn.run("app:app", host="127.0.0.1", port=8001, reload=False)
