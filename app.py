import os
import base64
import hashlib
import httpx
import asyncio
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import List
from cachetools import TTLCache

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEPLOY_STATIC_DIR = os.path.join(BASE_DIR, "static")
ANGULAR_DIR = os.path.join(BASE_DIR, "dist", "debugTool")

_retrieve_cache: TTLCache = TTLCache(maxsize=10, ttl=120)
_list_metadata_cache: TTLCache = TTLCache(maxsize=200, ttl=300)
_http_client: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))
    yield
    await _http_client.aclose()

app = FastAPI(lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)

if os.path.isdir(DEPLOY_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=DEPLOY_STATIC_DIR), name="deploy-static")

# Natural-language flow builder - a separate FastAPI app (its own repo, own
# static assets, own /api/*), mounted whole rather than merged route by route.
from server import app as flow_tool_app  # noqa: E402

app.mount("/flow-tool", flow_tool_app)


@app.get("/flow-tool")
def flow_tool_trailing_slash():
    # Without the trailing slash, flow-tool's relative asset paths would
    # resolve one level up. Explicit rather than relying on Starlette's mount
    # redirect, which the Angular catch-all below pre-empts.
    return RedirectResponse(url="/flow-tool/")

# Job search tool - deployed as its own separate Heroku app/dyno, so this is
# a plain external redirect rather than an in-process mount like flow-tool.
JOB_SEARCH_TOOL_URL = "https://job-search-tool-ide-569997069814.herokuapp.com/"

@app.get("/job-search-tool")
def job_search_tool_redirect():
    return RedirectResponse(url=JOB_SEARCH_TOOL_URL)

def get_soap_headers():
    return {"Content-Type": "text/xml; charset=UTF-8", "SOAPAction": '""'}

_SOAP_NS = {
    'soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
    'met': 'http://soap.sforce.com/2006/04/metadata'
}

# --- Deploy Tool ---

@app.get("/deploytool")
def deploy_tool():
    return FileResponse(os.path.join(DEPLOY_STATIC_DIR, "index.html"))

@app.get("/metadata-kb")
def metadata_kb():
    return FileResponse(os.path.join(DEPLOY_STATIC_DIR, "metadata-kb.html"))

@app.get("/audit-trail-search")
def audit_trail_search():
    return FileResponse(os.path.join(DEPLOY_STATIC_DIR, "audit-trail-search.html"))

@app.get("/access-tool")
def access_tool():
    return FileResponse(os.path.join(DEPLOY_STATIC_DIR, "access-tool.html"))

@app.get("/api/config")
def get_config():
    return {"clientId": os.environ.get("SF_CLIENT_ID", "")}

@app.get("/.well-known/appspecific/com.chrome.devtools.json")
def chrome_devtools():
    return Response(content="{}", media_type="application/json")

# --- Metadata API Proxy ---

class RetrieveRequest(BaseModel):
    instanceUrl: str
    sessionId: str
    apiVersion: str = "58.0"
    unpackagedXml: str

@app.post("/api/proxy/retrieve")
async def retrieve_metadata(req: RetrieveRequest):
    import re
    instance_url = req.instanceUrl if req.instanceUrl.startswith("http") else f"https://{req.instanceUrl}"
    cache_key = (instance_url, hashlib.sha256(req.unpackagedXml.encode()).hexdigest())
    if cache_key in _retrieve_cache:
        zip_bytes = _retrieve_cache[cache_key]
        print(f"[RETRIEVE] Cache hit {instance_url} ({len(zip_bytes):,} bytes)")
        return Response(content=zip_bytes, media_type="application/zip")

    url = f"{instance_url}/services/Soap/m/{req.apiVersion}"
    clean_xml = re.sub(r'<\?xml.*?\?>', '', req.unpackagedXml).strip()
    clean_xml = clean_xml.replace('<Package', '<met:unpackaged').replace('</Package>', '</met:unpackaged>')

    retrieve_soap = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>{req.sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:retrieve><met:retrieveRequest>
    <met:apiVersion>{req.apiVersion}</met:apiVersion>
    {clean_xml}
  </met:retrieveRequest></met:retrieve></soapenv:Body>
</soapenv:Envelope>"""

    init_resp = await _http_client.post(url, content=retrieve_soap, headers=get_soap_headers())
    if init_resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to initiate retrieve: {init_resp.text}")

    root = ET.fromstring(init_resp.text)
    body = root.find('soapenv:Body', _SOAP_NS)
    job_id = body.find('met:retrieveResponse/met:result/met:id', _SOAP_NS).text
    print(f"[RETRIEVE] Job {job_id} queued. Polling...")

    check_soap = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>{req.sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:checkRetrieveStatus>
    <met:asyncProcessId>{job_id}</met:asyncProcessId>
    <met:includeZip>true</met:includeZip>
  </met:checkRetrieveStatus></soapenv:Body>
</soapenv:Envelope>"""

    while True:
        poll = await _http_client.post(url, content=check_soap, headers=get_soap_headers())
        text = poll.text
        if "status>InProgress" in text or "status>Pending" in text:
            await asyncio.sleep(1)
            continue
        root = ET.fromstring(text)
        body = root.find('soapenv:Body', _SOAP_NS)
        fault = body.find('soapenv:Fault', _SOAP_NS)
        if fault is not None:
            raise HTTPException(status_code=400, detail=fault.findtext('faultstring', default='Unknown error'))
        result = body.find('.//met:result', _SOAP_NS)
        if result is None:
            raise HTTPException(status_code=400, detail="No result node in retrieve response")
        if result.findtext('met:success', namespaces=_SOAP_NS) == 'false':
            raise HTTPException(status_code=400, detail=result.findtext('met:errorMessage', namespaces=_SOAP_NS) or 'Retrieve failed')
        zip_b64 = result.findtext('met:zipFile', namespaces=_SOAP_NS)
        if not zip_b64:
            raise HTTPException(status_code=400, detail="No ZIP file in retrieve response")
        zip_bytes = base64.b64decode(zip_b64)
        _retrieve_cache[cache_key] = zip_bytes
        print(f"[RETRIEVE] Job {job_id} complete. {len(zip_bytes):,} bytes.")
        return Response(content=zip_bytes, media_type="application/zip")


class DeployRequest(BaseModel):
    instanceUrl: str
    sessionId: str
    apiVersion: str = "58.0"
    zipBase64: str
    testLevel: str = "NoTestRun"
    testClasses: List[str] = []
    checkOnly: bool = True

@app.post("/api/proxy/deploy")
async def deploy_metadata(req: DeployRequest):
    instance_url = req.instanceUrl if req.instanceUrl.startswith("http") else f"https://{req.instanceUrl}"
    url = f"{instance_url}/services/Soap/m/{req.apiVersion}"
    tests_xml = "".join(f"<met:runTests>{t}</met:runTests>\n" for t in req.testClasses)

    deploy_soap = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>{req.sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:deploy>
    <met:zipFile>{req.zipBase64}</met:zipFile>
    <met:DeployOptions>
      <met:allowMissingFiles>false</met:allowMissingFiles>
      <met:autoUpdatePackage>false</met:autoUpdatePackage>
      <met:checkOnly>{str(req.checkOnly).lower()}</met:checkOnly>
      <met:ignoreWarnings>false</met:ignoreWarnings>
      <met:performRetrieve>false</met:performRetrieve>
      <met:purgeOnDelete>false</met:purgeOnDelete>
      <met:rollbackOnError>true</met:rollbackOnError>
      <met:testLevel>{req.testLevel}</met:testLevel>
      {tests_xml}
    </met:DeployOptions>
  </met:deploy></soapenv:Body>
</soapenv:Envelope>"""

    print(f"[DEPLOY] To {instance_url} checkOnly={req.checkOnly} testLevel={req.testLevel}")
    resp = await _http_client.post(url, content=deploy_soap, headers=get_soap_headers())
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Deploy failed: {resp.text}")
    root = ET.fromstring(resp.text)
    body = root.find('soapenv:Body', _SOAP_NS)
    job_id = body.find('met:deployResponse/met:result/met:id', _SOAP_NS).text
    print(f"[DEPLOY] Job {job_id} queued.")
    return {"jobId": job_id}


@app.get("/api/proxy/status/{job_id}")
async def check_deploy_status(job_id: str, instanceUrl: str = Query(...), sessionId: str = Query(...), apiVersion: str = Query("58.0")):
    instance_url = instanceUrl if instanceUrl.startswith("http") else f"https://{instanceUrl}"
    url = f"{instance_url}/services/Soap/m/{apiVersion}"
    status_soap = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>{sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:checkDeployStatus>
    <met:asyncProcessId>{job_id}</met:asyncProcessId>
    <met:includeDetails>true</met:includeDetails>
  </met:checkDeployStatus></soapenv:Body>
</soapenv:Envelope>"""

    async def stream_response():
        async with _http_client.stream("POST", url, content=status_soap, headers=get_soap_headers()) as r:
            async for chunk in r.aiter_bytes():
                yield chunk
    return StreamingResponse(stream_response(), media_type="text/xml")


class ListMetadataRequest(BaseModel):
    instanceUrl: str
    sessionId: str
    apiVersion: str = "58.0"
    types: List[str]

@app.post("/api/proxy/listMetadata")
async def list_metadata(req: ListMetadataRequest):
    cache_key = (req.instanceUrl, tuple(sorted(req.types)))
    if cache_key in _list_metadata_cache:
        return _list_metadata_cache[cache_key]
    instance_url = req.instanceUrl if req.instanceUrl.startswith("http") else f"https://{req.instanceUrl}"
    url = f"{instance_url}/services/Soap/m/{req.apiVersion}"
    queries_xml = "".join(f"<met:queries><met:type>{t}</met:type></met:queries>\n" for t in req.types[:3])

    list_soap = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>{req.sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:listMetadata>
{queries_xml}    <met:asOfVersion>{req.apiVersion}</met:asOfVersion>
  </met:listMetadata></soapenv:Body>
</soapenv:Envelope>"""

    resp = await _http_client.post(url, content=list_soap, headers=get_soap_headers())
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"listMetadata failed: {resp.text}")
    root = ET.fromstring(resp.text)
    body = root.find('soapenv:Body', _SOAP_NS)
    fault = body.find('soapenv:Fault', _SOAP_NS)
    if fault is not None:
        raise HTTPException(status_code=400, detail=f"listMetadata SOAP fault: {fault.findtext('faultstring', default='')}")
    list_response = body.find('met:listMetadataResponse', _SOAP_NS)
    results = []
    if list_response is not None:
        for res in list_response.findall('met:result', _SOAP_NS):
            results.append({
                "fullName": res.findtext('met:fullName', default="", namespaces=_SOAP_NS),
                "type": res.findtext('met:type', default="", namespaces=_SOAP_NS),
                "lastModifiedByName": res.findtext('met:lastModifiedByName', default="", namespaces=_SOAP_NS),
                "lastModifiedDate": res.findtext('met:lastModifiedDate', default="", namespaces=_SOAP_NS)
            })
    result = {"result": results}
    _list_metadata_cache[cache_key] = result
    return result


@app.get("/api/proxy/query")
async def standard_query(instanceUrl: str, sessionId: str, q: str):
    instance_url = instanceUrl.rstrip('/')
    instance_url = instance_url if instance_url.startswith("http") else f"https://{instance_url}"
    headers = {"Authorization": f"Bearer {sessionId}", "Accept": "application/json"}
    all_records = []
    res = await _http_client.get(f"{instance_url}/services/data/v58.0/query", params={"q": q}, headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail=res.text)
    data = res.json()
    all_records.extend(data.get("records", []))
    while not data.get("done", True) and data.get("nextRecordsUrl"):
        res = await _http_client.get(f"{instance_url}{data['nextRecordsUrl']}", headers=headers)
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=res.text)
        data = res.json()
        all_records.extend(data.get("records", []))
    data["records"] = all_records
    data["done"] = True
    data["totalSize"] = len(all_records)
    return data


@app.get("/api/proxy/tooling/query")
async def tooling_query(instanceUrl: str, sessionId: str, q: str):
    instance_url = instanceUrl.rstrip('/')
    instance_url = instance_url if instance_url.startswith("http") else f"https://{instance_url}"
    headers = {"Authorization": f"Bearer {sessionId}", "Accept": "application/json"}
    res = await _http_client.get(f"{instance_url}/services/data/v58.0/tooling/query", params={"q": q}, headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail=res.text)
    return res.json()


class CompositeRequest(BaseModel):
    instanceUrl: str
    sessionId: str
    compositeRequest: List[dict]

@app.post("/api/proxy/composite")
async def composite_proxy(req: CompositeRequest):
    """Batches multiple REST/Tooling subrequests (each a relative /services/data/... url) into one round trip."""
    instance_url = req.instanceUrl.rstrip('/')
    instance_url = instance_url if instance_url.startswith("http") else f"https://{instance_url}"
    headers = {"Authorization": f"Bearer {req.sessionId}", "Content-Type": "application/json"}
    res = await _http_client.post(
        f"{instance_url}/services/data/v58.0/composite",
        json={"compositeRequest": req.compositeRequest, "allOrNone": False},
        headers=headers
    )
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail=res.text)
    return res.json()


# --- Angular SPA catch-all (must be last) ---

@app.get("/{full_path:path}")
def angular_spa(full_path: str = ""):
    if os.path.isdir(ANGULAR_DIR):
        candidate = os.path.join(ANGULAR_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(ANGULAR_DIR, "index.html"))
    return Response("App is building...", status_code=503)
