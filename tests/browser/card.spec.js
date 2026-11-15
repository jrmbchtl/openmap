import { test, expect } from "@playwright/test";

async function open(page, path = "/tests/browser/card.html") {
  await page.route("https://tile.openstreetmap.org/**", async route => {
    const response = await page.request.get("http://127.0.0.1:8765/basemap/test.png");
    await route.fulfill({ response, headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" } });
  });
  const response = await page.goto(path);
  await page.waitForFunction(() => !!window.card?._engine);
  await expect.poll(() => page.evaluate(() => window.card._engine.features.size)).toBe(3);
  return response;
}

async function settleMap(page) {
  await page.evaluate(async () => {
    const card = window.card;
    await card.updateComplete;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const map = card._engine.map;
    // Loading counters can be zero before a new view queues its tiles.
    // OpenLayers emits rendercomplete only after the visible frame is loaded.
    await new Promise(resolve => { map.once('rendercomplete', resolve); map.renderSync(); });
    await card.updateComplete;
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

test("basemap requests identify OSM with origin-only referrers under HA headers", async ({ page }) => {
  const osm = [], carto = [];
  page.on("request", request => {
    if (request.url().startsWith("https://tile.openstreetmap.org/")) osm.push(request);
    if (request.url().startsWith("https://a.basemaps.cartocdn.com/")) carto.push(request);
  });
  const response = await open(page, "/tests/browser/card.html?dashboard=private&token=fixture-only#household");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  const origin = `${new URL(response.url()).origin}/`;
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const assertOsm = async () => {
    await expect.poll(() => osm.length).toBeGreaterThan(0);
    await settleMap(page);
    for (const request of osm) {
      const headers = await request.allHeaders();
      expect(headers.referer).toBe(origin);
      expect(headers["user-agent"]).toBe(userAgent);
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(headers["cache-control"]).toBeUndefined();
      expect(headers.pragma).toBeUndefined();
      expect(new URL(request.url()).search).toBe("");
    }
  };
  await assertOsm();

  // Missing CARTO credentials fall back to OSM with the same provider policy.
  await page.route("**/api/openmap/basemap_key", route => route.fulfill({ status: 404 }));
  osm.length = 0;
  // A different synthetic zoom avoids browser image reuse hiding wire headers.
  await page.evaluate(() => window.card.setConfig({ ...window.card._config, basemap: "carto", default_zoom: 13 }));
  await page.waitForFunction(() => window.card._engine && window.card._keyWarning);
  await assertOsm();
  expect(carto).toHaveLength(0);

  // A configured CARTO key must not widen that provider's existing policy.
  await page.unroute("**/api/openmap/basemap_key");
  await page.route("**/api/openmap/basemap_key", route => route.fulfill({
    status: 200, contentType: "application/json", body: '{"carto_api_key":"fixture-carto-key"}',
  }));
  await page.route("https://a.basemaps.cartocdn.com/**", async route => {
    const tile = await page.request.get("http://127.0.0.1:8765/basemap/test.png");
    await route.fulfill({ response: tile, headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" } });
  });
  await page.evaluate(() => window.card.setConfig({ ...window.card._config, basemap: "carto" }));
  await expect.poll(() => carto.length).toBeGreaterThan(0);
  await settleMap(page);
  for (const request of carto) expect((await request.allHeaders()).referer).toBeUndefined();
});

test("production renderer, authenticated rasters, remembered layers and safe details", async ({ page }, testInfo) => {
  const errors = []; const traffic = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/openmap/traffic/")) traffic.push(request); });
  await open(page);
  await expect.poll(() => traffic.length).toBeGreaterThan(0);
  expect(traffic.every(request => request.headers().authorization === "Bearer fixture-only")).toBe(true);
  await page.getByRole("button", { name: "Traffic layers", exact: true }).click();
  await page.getByRole("switch", { name: "Parking zones" }).check();
  await expect.poll(() => page.evaluate(() => Object.values(window.card._status).every(s => s.loading === 0))).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(window.card._preferenceKey)).parken)).toBe(true);
  await settleMap(page);
  await page.screenshot({ path: `.impeccable/review/${testInfo.project.name === "desktop" ? "desktop" : "mobile"}-traffic.png`, fullPage: true, animations:'disabled' });
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Entities", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search entities" }).fill("Alex");
  await page.getByRole("button", { name: "Alex home" }).click();
  await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex" })).toBeFocused();
  await expect(page.getByRole("definition").filter({ hasText: "30 m" })).toBeVisible();
  let detail;
  await page.evaluate(() => { window.card.addEventListener("hass-more-info", event => { window.moreInfo = event.detail; }); });
  await page.getByRole("button", { name: "More details" }).click();
  detail = await page.evaluate(() => window.moreInfo); expect(detail.entityId).toBe("person.alex");
  await settleMap(page);
  await page.screenshot({ path: `.impeccable/review/${testInfo.project.name === "desktop" ? "desktop" : "mobile"}.png`, fullPage: true, animations:'disabled' });
  await page.evaluate(() => { window.fixtureHass = { ...window.fixtureHass, states: { ...window.fixtureHass.states, "person.alex": { ...window.fixtureHass.states["person.alex"], attributes: { friendly_name: '<img src=x onerror="window.attacked=true">', latitude: 0, longitude: 0 } } } }; window.card.hass = window.fixtureHass; });
  await expect(page.getByRole("heading", { name: '<img src=x onerror="window.attacked=true">' })).toBeVisible();
  expect(await page.evaluate(() => window.attacked)).toBeUndefined();
  expect(await page.evaluate(() => window.card.shadowRoot.querySelectorAll("img").length)).toBe(0);
  expect(errors).toEqual([]);
  await page.evaluate(() => { window.engine = window.card._engine; window.card.remove(); });
  expect(await page.evaluate(() => window.engine.disposed && window.engine.loader.controller.signal.aborted)).toBe(true);
});

test("error/retry, keyboard switches, reload preferences, dark German and narrow card layout", async ({ page }, testInfo) => {
  await page.route("**/api/openmap/traffic/**", route => route.fulfill({status:503,contentType:"application/json",body:'{"error":"fixture unavailable"}'}));
  await open(page);
  await expect(page.getByText("Some traffic tiles could not load.", {exact:false})).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.values(window.card._status).every(s => s.loading === 0))).toBe(true);
  await settleMap(page);
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name}-error.png`,fullPage:true,animations:'disabled'});
  await page.unroute("**/api/openmap/traffic/**");
  await page.getByRole("button", {name:"Retry",exact:true}).click();
  await expect(page.getByText("Some traffic tiles could not load.", {exact:false})).toHaveCount(0);
  await page.getByRole("button", {name:"Traffic layers",exact:true}).click();
  const parking=page.getByRole("switch", {name:"Parking zones"});
  await parking.focus(); await page.keyboard.press("Space"); await expect(parking).toBeChecked();
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", {name:"Traffic layers",exact:true})).toBeFocused();
  await page.reload(); await page.waitForFunction(() => !!window.card?._engine);
  expect(await page.evaluate(() => window.card._visibility.parken)).toBe(true);
  await page.evaluate(() => { document.body.classList.add('dark'); window.card.hass={...window.fixtureHass,language:'de',themes:{darkMode:true}}; });
  await page.waitForFunction(() => !!window.card._engine);
  await page.getByRole("button", {name:"Verkehrsebenen",exact:true}).click();
  await expect(page.getByRole("switch", {name:"Parking zones"})).toBeChecked();
  await expect.poll(() => page.evaluate(() => Object.values(window.card._status).every(s => s.loading === 0))).toBe(true);
  await settleMap(page);
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name}-dark-de.png`,fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:320,height:600});
  await page.evaluate(() => { window.card.style.height='480px'; });
  const dimensions=await page.evaluate(() => {
    const root=window.card.shadowRoot;
    const workspace=root.querySelector('.workspace').getBoundingClientRect();
    const inspector=root.querySelector('.inspector').getBoundingClientRect();
    const buttons=[...root.querySelectorAll('nav button,.map-actions button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}));
    const actions=[...root.querySelectorAll('.map-actions button')].every(button=>{
      const rect=button.getBoundingClientRect();
      return rect.bottom<=inspector.top && button.contains(root.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
    });
    return {bodyOverflow:document.documentElement.scrollWidth>window.innerWidth,inside:inspector.bottom<=workspace.bottom && inspector.left>=workspace.left && inspector.right<=workspace.right,buttons,actions};
  });
  expect(dimensions.bodyOverflow).toBe(false);expect(dimensions.inside).toBe(true);
  expect(dimensions.buttons.every(b=>b.height>=48 && b.width>=48)).toBe(true);
  expect(dimensions.actions).toBe(true);
  await settleMap(page);
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name}-320.png`,fullPage:true,animations:'disabled'});
});

test("incremental 100 entities, missing/unavailable removal, reconnect, empty setup and recovery", async ({ page }, testInfo) => {
  await open(page);
  const result = await page.evaluate(() => {
    const engine = window.card._engine; const original = engine.features.get("person.alex");
    const before = performance.now();
    for (let n = 0; n < 100; n++) {
      const id = `person.fixture_${n}`;
      window.fixtureHass.states[id] = { entity_id:id,state:'home',attributes:{latitude:48.892+n*.0001,longitude:9.192+n*.0001,friendly_name:`Fixture ${n}`},last_updated:'2026-11-14T12:00:00Z' };
    }
    window.card.setConfig({ ...window.card._config, include_domains:['person'] });
    window.card.hass = {...window.fixtureHass};
    return { duration:performance.now()-before, originalExists:!!original };
  });
  expect(result.duration).toBeLessThan(1000);
  await page.waitForFunction(() => window.card._engine?.features.size === 103);
  const unchanged = await page.evaluate(() => {
    const engine = window.card._engine; const feature = engine.features.get('person.alex');
    window.card.hass = {...window.fixtureHass};
    const stable = feature === engine.features.get('person.alex');
    window.card.hass = {...window.fixtureHass,states:{...window.fixtureHass.states,'person.alex':{...window.fixtureHass.states['person.alex'],state:'unavailable'}}};
    return { stable, removed:!engine.features.has('person.alex') };
  });
  expect(unchanged).toEqual({ stable:true,removed:true });
  await page.evaluate(() => { const card=window.card;card.remove();document.body.append(card); });
  await page.waitForFunction(() => !!window.card._engine);
  await page.evaluate(() => window.card.setConfig({ entities:[],overlay_layers:[] }));
  await expect(page.getByRole("heading", { name:"Choose what goes on your map" })).toBeVisible();
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name}-empty.png`,fullPage:true,animations:'disabled'});
  await page.getByRole("button", { name:"Configure map" }).click();
  await expect(page.getByText("In dashboard edit mode", { exact:false })).toBeVisible();
  await expect(page.getByRole('heading', {name:'Configure map',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name:'Configure map',exact:true})).toBeFocused();
});

test('review corrections: sheet-aware traffic fit, keyboard continuity and hovered contrast', async ({page}, testInfo) => {
  await open(page);
  const entities=page.getByRole('button', {name:'Entities',exact:true});
  await entities.click();
  await page.getByRole('button', {name:'Alex home'}).click();
  await expect(page.getByRole('heading', {name:'Alex',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name:'Show on map',exact:true})).toBeFocused();
  await page.getByRole('button', {name:'Show on map',exact:true}).hover();
  const contrast = await page.evaluate(() => {
    const luminance = color => {
      const channels=color.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
    };
    const ratio = element => {
      const style=getComputedStyle(element);
      const foreground=luminance(style.color),background=luminance(style.backgroundColor);
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    };
    const root=window.card.shadowRoot;
    return [ratio(root.querySelector('[data-pane="entities"]')),ratio(root.querySelector('.detail-actions button'))];
  });
  expect(contrast.every(value=>value>=4.5)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(entities).toBeFocused();
  await page.getByRole('button', {name:'Traffic layers',exact:true}).click();
  await page.getByRole('button', {name:'Show Ludwigsburg',exact:true}).click();
  await settleMap(page);
  const targetVisible = await page.evaluate(() => {
    const root=window.card.shadowRoot,engine=window.card._engine;
    const area=engine.traffic.get('bus').layer.getExtent();
    const pixel=engine.map.getPixelFromCoordinate([(area[0]+area[2])/2,(area[1]+area[3])/2]);
    const workspace=root.querySelector('.workspace').getBoundingClientRect();
    const inspector=root.querySelector('.inspector').getBoundingClientRect();
    const x=pixel[0]+workspace.x,y=pixel[1]+workspace.y;
    return x>=workspace.left && x<=workspace.right && y>=workspace.top && y<=workspace.bottom && !(x>=inspector.left && x<=inspector.right && y>=inspector.top && y<=inspector.bottom);
  });
  expect(targetVisible).toBe(true);
  await expect.poll(()=>page.evaluate(()=>Object.values(window.card._status).every(s=>s.loading===0))).toBe(true);
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name==='desktop'?'desktop':'mobile'}-traffic-focus.png`,fullPage:true,animations:'disabled'});
});

test("sidebar menu, viewport sizing, error resize and hidden-layer cancellation", async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(() => {
    document.querySelector('.fixture-label').style.display='none';
    window.card.style.height='';
    window.card.panel={config:{...window.card._config,title:'Synthetic household & traffic'}};
    window.card.narrow=true;
    document.body.addEventListener('hass-toggle-menu', event => {
      window.menuEvent={bubbles:event.bubbles,composed:event.composed};
    });
  });
  await page.waitForFunction(() => !!window.card._engine);
  await page.getByRole('button', {name:'Menu',exact:true}).click();
  expect(await page.evaluate(() => window.menuEvent)).toEqual({bubbles:true,composed:true});
  await expect.poll(() => page.evaluate(() => {
    const workspace=window.card.shadowRoot.querySelector('.workspace');
    return window.card._engine.map.getSize().join(',')===`${workspace.clientWidth},${workspace.clientHeight}`;
  })).toBe(true);
  expect(await page.evaluate(() => Math.abs(window.card.getBoundingClientRect().height-window.innerHeight))).toBeLessThan(1);
  await page.getByRole('button', {name:'Entities',exact:true}).click();
  await expect(page.getByText('Phone offline', {exact:true})).toBeVisible();
  await settleMap(page);
  await page.screenshot({path:`.impeccable/review/${testInfo.project.name}-sidebar.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button', {name:'Close inspector',exact:true}).click();
  await page.getByRole('button', {name:'Traffic layers',exact:true}).click();
  await page.evaluate(() => { window.layerController=window.card._engine.traffic.get('bus').controller; });
  await page.getByRole('switch', {name:'Bus lines & stops'}).uncheck();
  expect(await page.evaluate(() => window.layerController.signal.aborted && !window.card._engine.traffic.get('bus').layer.getSource())).toBe(true);
  await page.route('**/api/openmap/traffic/**', route => route.fulfill({status:503,body:'fixture error'}));
  await page.getByRole('switch', {name:'Bus lines & stops'}).check();
  await expect(page.getByText('Some traffic tiles could not load.', {exact:false})).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const workspace=window.card.shadowRoot.querySelector('.workspace');
    return window.card._engine.map.getSize().join(',')===`${workspace.clientWidth},${workspace.clientHeight}`;
  })).toBe(true);
});

test("editor is lazy and rich configuration survives content selection", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => !!customElements.get("openmap-card-editor"))).toBe(false);
  const data = await page.evaluate(async () => {
    const editor = await window.card.constructor.getConfigElement();
    editor.hass=window.fixtureHass;
    editor.setConfig({entities:[{entity:'person.alex',name:'Custom Alex',color:'#ff0000'}],overlay_layers:[{preset:'bus',name:'Custom buses',visible:true,opacity:.4}],marker:{popup:{fields:[{label:'Safe',value:'state'}]}}});
    document.body.append(editor); await editor.updateComplete;
    editor._change({stopPropagation(){},detail:{value:{title:'Edited'}}});
    return editor._config;
  });
  expect(data.entities[0]).toEqual({entity:'person.alex',name:'Custom Alex',color:'#ff0000'});
  expect(data.overlay_layers[0]).toEqual({preset:'bus',name:'Custom buses',visible:true,opacity:.4});
  expect(data.marker.popup.fields).toEqual([{label:'Safe',value:'state'}]);
});
