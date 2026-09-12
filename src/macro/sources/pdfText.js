import { spawn } from "node:child_process";
// Pipe bounded bytes directly to Poppler; no shell, temporary files, or blocking process.
export function extractPdfText(bytes,executable){
  if(!executable)throw new TypeError("Configure MACRO_PDFTOTEXT_PATH to a pdftotext executable");
  if(!Buffer.isBuffer(bytes)||bytes.length>5*1024*1024||bytes.subarray(0,5).toString()!=="%PDF-")throw new TypeError("Invalid claims PDF");
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,["-layout","-","-"],{windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]});
    let output=[],length=0,finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(value);};
    const timer=setTimeout(()=>finish(new Error("Claims PDF extraction timed out")),10000);
    child.on("error",e=>finish(new Error(`Claims PDF extractor unavailable: ${e.code||"failed"}`)));
    child.stdout.on("data",chunk=>{length+=chunk.length;if(length>2*1024*1024)finish(new Error("Claims PDF text exceeds limit"));else output.push(chunk);});
    child.stderr.resume();child.stdin.on("error",()=>{});
    child.on("close",code=>code===0?finish(null,Buffer.concat(output).toString("utf8")):finish(new Error(`Claims PDF extraction failed (${code})`)));
    child.stdin.end(bytes);
  });
}
