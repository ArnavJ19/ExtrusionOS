import {createServer} from "node:http";
import {build} from "esbuild";
import {chromium} from "@playwright/test";

export async function createSearchableSelectBrowserFixture(){
  const bundle=await build({stdin:{contents:`import React,{useState} from "react";import {createRoot} from "react-dom/client";
    import {SearchableSelect} from "./components/ui/searchable-select";
    function Fixture(){
      const [value,setValue]=useState("alpha"),[searching,setSearching]=useState(false),[disabled,setDisabled]=useState(false),[mounted,setMounted]=useState(true);
      const [options,setOptions]=useState([{value:"alpha",label:"Alpha profile"},{value:"beta",label:"Beta profile"},{value:"gamma",label:"Gamma profile"}]);
      window.__select={setValue,setSearching,setDisabled,setOptions,setMounted,changes:window.__select?.changes||[],searches:window.__select?.searches||[],submits:window.__select?.submits||0};
      return <form data-searching={searching} onSubmit={event=>{event.preventDefault();window.__select.submits++;}}>
        {mounted?<SearchableSelect ariaLabel="Profile" value={value} options={options} searching={searching} disabled={disabled}
          onSearchChange={query=>window.__select.searches.push(query)} onChange={next=>{window.__select.changes.push(next);setValue(next);}}/>:null}
        <input aria-label="Next field"/><button type="submit">Save</button><output data-value>{value}</output>
      </form>;
    }createRoot(document.getElementById("app")).render(<Fixture/>);`,resolveDir:process.cwd(),sourcefile:"select-fixture.tsx",loader:"tsx"},
    bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":"\"production\""}});
  const server=createServer((request,response)=>{
    if(request.url==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(bundle.outputFiles[0].contents);return;}
    response.writeHead(200,{"Content-Type":"text/html"}).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main id="app"></main><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(ready=>server.listen(0,"127.0.0.1",ready));
  let browser;
  try{
    browser=await chromium.launch({headless:true});const context=await browser.newContext();
    const base=`http://127.0.0.1:${server.address().port}`;
    await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();
    return {page,base,async reset(){await page.goto(base);await page.getByLabel("Profile",{exact:true}).waitFor();},
      async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}};
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
