class Basin{
    constructor(load,opts){
        if(!opts) opts = {};
        this.seasons = {};
        this.seasonsBusyLoading = {};
        this.seasonExpirationTimers = {};
        this.activeSystems = [];
        this.subBasins = {};
        this.tick = 0;
        this.lastSaved = 0;
        this.godMode = opts.godMode;
        this.SHem = opts.hem;
        this.actMode = opts.actMode || 0;
        if(SEASON_CURVE[this.actMode])
            seasonCurve = window[SEASON_CURVE[this.actMode]];
        else
            seasonCurve = window[SEASON_CURVE.default];
        if(opts.year !== undefined)
            this.startYear = opts.year;
        else if(this.SHem)
            this.startYear = SHEM_DEFAULT_YEAR;
        else
            this.startYear = NHEM_DEFAULT_YEAR;
        this.mapType = opts.mapType || 0;
        if(MAP_TYPES[this.mapType].form === 'earth'){
            this.mainSubBasin = MAP_TYPES[this.mapType].mainSubBasin;
            this.defineEarthSubBasins();
            this.subBasins[this.mainSubBasin].scale = Scale.presetScales[opts.scale || 0].clone().flavor(opts.scaleFlavor || 0);
            this.subBasins[this.mainSubBasin].setDesignationSystem(DesignationSystem.presetDesignationSystems[opts.designations || 0].clone().setSecondary(false));
        }else{
            this.mainSubBasin = DEFAULT_MAIN_SUBBASIN;
            this.addSubBasin(this.mainSubBasin,undefined,undefined,undefined,
                Scale.presetScales[opts.scale || 0].clone().flavor(opts.scaleFlavor || 0),
                DesignationSystem.presetDesignationSystems[opts.designations || 0].clone().setSecondary(false)
            );
        }
        // if(MAP_TYPES[this.mapType].special==='CPac'){
        //     this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.naming.crossingMode = DESIG_CROSSMODE_KEEP;
        //     this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.numbering.crossingMode = DESIG_CROSSMODE_KEEP;
        //     this.addSubBasin(128,undefined,'Central Pacific',DEFAULT_MAIN_SUBBASIN,undefined,
        //         DesignationSystem.centralPacific.clone().setCrossingModes(DESIG_CROSSMODE_KEEP,DESIG_CROSSMODE_KEEP)
        //     );
        // }else if(MAP_TYPES[this.mapType].special==='PAGASA'){
        //     this.addSubBasin(128,undefined,'PAGASA AoR',DEFAULT_MAIN_SUBBASIN,undefined,
        //         DesignationSystem.PAGASA.clone()
        //     );
        // }else if(MAP_TYPES[this.mapType].special==='NIO'){
        //     // this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.numbering.enabled = false;
        //     // this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.numbering.prefix = undefined;
        //     // this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.numbering.suffix = undefined;
        //     this.addSubBasin(128,undefined,'Arabian Sea',DEFAULT_MAIN_SUBBASIN,undefined,
        //         new DesignationSystem({
        //             prefix: 'ARB',
        //             numCross: DESIG_CROSSMODE_KEEP
        //         })
        //     );
        //     this.addSubBasin(129,undefined,'Bay of Bengal',DEFAULT_MAIN_SUBBASIN,undefined,
        //         new DesignationSystem({
        //             prefix: 'BOB',
        //             numCross: DESIG_CROSSMODE_KEEP
        //         })
        //     );
        // }else if(MAP_TYPES[this.mapType].special==='AUS'){
        //     this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.naming.crossingMode = DESIG_CROSSMODE_KEEP;
        //     this.subBasins[DEFAULT_MAIN_SUBBASIN].designationSystem.numbering.crossingMode = DESIG_CROSSMODE_KEEP;
        //     this.addSubBasin(128,undefined,'Jakarta TCWC',DEFAULT_MAIN_SUBBASIN,undefined,
        //         DesignationSystem.australianRegionJakarta.clone().setCrossingModes(undefined,DESIG_CROSSMODE_KEEP)
        //     );
        //     this.addSubBasin(129,undefined,'Port Moresby TCWC',DEFAULT_MAIN_SUBBASIN,undefined,
        //         DesignationSystem.australianRegionPortMoresby.clone().setCrossingModes(undefined,DESIG_CROSSMODE_KEEP)
        //     );
        // }
        this.seed = opts.seed || moment().valueOf();
        this.env = new Environment(this);
        this.saveName = load || AUTOSAVE_SAVE_NAME;
        if(load) this.initialized = this.load();
        else{
            let mapImg;
            Basin.deleteSave(AUTOSAVE_SAVE_NAME);
            let f = ()=>{
                noiseSeed(this.seed);
                this.env.init();
                land = new Land(this, mapImg);
                this.seasons[this.getSeason(-1)] = new Season(this);
                this.expireSeasonTimer(this.getSeason(-1));
                this.env.record();
            };
            if(MAP_TYPES[this.mapType].form==='pixelmap' || MAP_TYPES[this.mapType].form==='earth'){
                let path;
                if(MAP_TYPES[this.mapType].form==='earth')
                    path = EARTH_MAP_PATH;
                else
                    path = MAP_TYPES[this.mapType].path;
                this.initialized = loadImg(path).then(img=>{
                    img.loadPixels();
                    mapImg = img;
                    f();
                    return this;
                }).catch(e=>{
                    console.error(e);
                });
            }else{
                f();
                this.initialized = Promise.resolve(this);
            }
        }
    }

    mount(){    // mounts the basin to the viewer
        viewTick = this.tick;
        UI.viewBasin = this;
        selectedStorm = undefined;
        paused = this.tick!==0;
        lastUpdateTimestamp = performance.now();
        refreshTracks(true);
        primaryWrapper.show();
        renderToDo = land.draw();
    }

    advanceSimOneStep(){
        let metadata = {needTrackRefresh: false, needForceTrackRefresh: false, needEnvLayerRefresh: false, needSave: false};
        let vp = this.viewingPresent();
        let os = this.getSeason(-1);
        this.tick++;
        let vs = this.getSeason(viewTick);
        viewTick = this.tick;
        let curSeason = this.getSeason(-1);
        if(curSeason!==os){
            let e = new Season(this);
            for(let s of this.activeSystems) e.addSystem(new StormRef(this,s.fetchStorm()));
            this.seasons[curSeason] = e;
            this.expireSeasonTimer(curSeason);
        }
        if(!vp || curSeason!==vs){
            metadata.needTrackRefresh = true;
            metadata.needForceTrackRefresh = curSeason!==vs;
        }
        this.env.wobble();    // random change in environment for future forecast realism
        for(let i=0;i<this.activeSystems.length;i++){   // update active storm systems
            for(let j=i+1;j<this.activeSystems.length;j++){
                this.activeSystems[i].interact(this.activeSystems[j],true);
            }
            this.activeSystems[i].update();
        }
        SPAWN_RULES[this.actMode].doSpawn(this);    // spawn new storm systems
        let stormKilled = false;
        for(let i=this.activeSystems.length-1;i>=0;i--){    // remove dead storm systems from activeSystems array
            if(!this.activeSystems[i].fetchStorm().current){
                this.activeSystems.splice(i,1);
                stormKilled = true;
            }
        }
        metadata.needTrackRefresh |= stormKilled;   // redraw tracks whenever a storm system dies
        if(this.tick % ADVISORY_TICKS === 0){   // redraw map layer and record environmental field state every advisory
            metadata.needEnvLayerRefresh = true;
            this.env.record();
        }
        let curTime = this.tickMoment();
        if(simSettings.doAutosave && (curTime.date()===1 || curTime.date()===15) && curTime.hour()===0)    // autosave at 00z on the 1st and 15th days of every month
            metadata.needSave = true;
        return metadata;
    }

    advanceSim(steps){
        if(steps === undefined)
            steps = 1;
        else if(steps === 0)
            return;
        
        const advDiff = Math.floor((this.tick + steps) / ADVISORY_TICKS) - Math.floor(this.tick / ADVISORY_TICKS);

        let needTrackRefresh = false,
            needForceTrackRefresh = false,
            needEnvLayerRefresh = false,
            needSave = false;

        for(let i = 0; i < steps; i++){
            let metadata = this.advanceSimOneStep();
            needTrackRefresh |= metadata.needTrackRefresh;
            needForceTrackRefresh |= metadata.needForceTrackRefresh;
            needEnvLayerRefresh |= metadata.needEnvLayerRefresh;
            needSave |= metadata.needSave;
        }

        if(needTrackRefresh || advDiff >= 2)
            refreshTracks(needForceTrackRefresh || advDiff >= 2);

        if(advDiff === 1){
            for(let i = 0; i < this.activeSystems.length; i++)
                this.activeSystems[i].fetchStorm().renderTrack(true);
        }

        if(needEnvLayerRefresh)
            this.env.displayLayer();
        else if(simSettings.showMagGlass)   // redraw magnifying glass if displayed (and if it wasn't already redrawn with the map layer)
            this.env.updateMagGlass();
        
        if(needSave)
            this.save();
    }

    startTime(){
        let y = this.startYear;
        let mo = moment.utc([y]);
        if(this.SHem){
            mo.month(6);
            mo.year(y-1);
        }
        return mo.valueOf();
    }

    tickMoment(t){
        if(t===undefined) t = this.tick;
        return moment.utc(this.startTime()+t*TICK_DURATION);
    }

    tickFromMoment(m){
        if(m instanceof moment) return floor((m.valueOf()-this.startTime())/TICK_DURATION);
    }

    seasonTick(n){
        if(n===undefined) n = this.getSeason(-1);
        let m = moment.utc(this.SHem ? [n-1, 6, 1] : [n, 0, 1]);
        let t = floor((m.valueOf()-this.startTime())/TICK_DURATION);
        t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
        return t;
    }

    viewingPresent(){
        return viewTick === this.tick;
    }

    hem(v){
        return this.SHem ? -v : v;
    }

    hemY(y){
        return this.SHem ? HEIGHT-y : y;
    }

    spawn(data){
        this.activeSystems.push(new ActiveSystem(this,data));
    }

    spawnArchetype(a,x,y){
        let data = {};
        let arch = [];
        let i = -1;
        let a1 = a;
        while(a1){
            i++;
            if(SPAWN_RULES[this.actMode].archetypes && SPAWN_RULES[this.actMode].archetypes[a1])
                arch[i] = SPAWN_RULES[this.actMode].archetypes[a1];
            else if(SPAWN_RULES.defaults.archetypes[a1])
                arch[i] = SPAWN_RULES.defaults.archetypes[a1];
            else{
                i--;
                break;
            }
            a1 = arch[i].inherit;
            if(a1 === a)
                break;
        }
        while(i >= 0){
            for(let k in arch[i]){
                if(k !== 'inherit'){
                    if(arch[i][k] instanceof Array)
                        data[k] = random(arch[i][k][0],arch[i][k][1]);
                    else
                        data[k] = arch[i][k];
                }
            }
            i--;
        }
        if(x !== undefined)
            data.x = x;
        if(y !== undefined)
            data.y = y;
        this.spawn(data);
    }

    addSubBasin(id,...args){
        id = parseInt(id);
        this.subBasins[id] = new SubBasin(this,id,...args);
    }

    subInBasin(sub){
        let s = this.subBasins[sub];
        if(s instanceof SubBasin) return !s.outBasin();
        if(sub===DEFAULT_OUTBASIN_SUBBASIN) return false;
        return true;
    }

    *forSubBasinChain(id){
        let s = this.subBasins[id];
        if(s instanceof SubBasin) yield* s.forChain();
        else{
            yield id;
            if(id!==DEFAULT_OUTBASIN_SUBBASIN) yield DEFAULT_MAIN_SUBBASIN;
        }
    }

    relevantPrimaryDesignationSubBasins(id){
        if(id !== undefined){
            let numbering;
            let naming;
            let altPre;
            let altSuf;
            for(let subId of this.forSubBasinChain(id)){
                let sb = this.subBasins[subId];
                if(sb instanceof SubBasin && sb.designationSystem){
                    let ds = sb.designationSystem;
                    if(!ds.secondary){
                        if(numbering===undefined){
                            if(ds.numbering.enabled) numbering = subId;
                            else{
                                if(ds.numbering.prefix!==undefined) altPre = ds.numbering.prefix;
                                if(ds.numbering.suffix!==undefined) altSuf = ds.numbering.suffix;
                            }
                        }
                        if(naming===undefined && ds.naming.mainLists.length>0) naming = subId;
                    }
                }
                if(numbering!==undefined && naming!==undefined) break;
            }
            return {numbering, naming, altPre, altSuf};
        }
    }

    getScale(sub){
        let scale;
        for(let subId of this.forSubBasinChain(sub)){
            let sb = this.subBasins[subId];
            if(sb instanceof SubBasin && sb.scale){
                scale = sb.scale;
                break;
            }
        }
        if(scale) return scale;
        let mainSB = this.subBasins[this.mainSubBasin];
        if(mainSB instanceof SubBasin && mainSB.scale) return mainSB.scale;
        return Scale.saffirSimpson;
    }

    getSeason(t){       // returns the year number of a season given a sim tick
        if(t===-1) t = this.tick;
        if(this.SHem){
            let tm = this.tickMoment(t);
            let m = tm.month();
            let y = tm.year();
            if(m>=6) return y+1;
            return y;
        }
        return this.tickMoment(t).year();
    }

    fetchSeason(n,isTick,loadedRequired,callback){  // returns the season object given a year number, or given a sim tick if isTick is true
        if(isTick) n = this.getSeason(n);
        let season;
        let promise;
        if(this.seasons[n]){
            season = this.seasons[n];
            promise = Promise.resolve(season);
        }else{
            if(this.seasonsBusyLoading[n]) promise = this.seasonsBusyLoading[n];
            else{
                promise = this.seasonsBusyLoading[n] = waitForAsyncProcess(()=>{
                    return db.seasons.where('[saveName+season]').equals([this.saveName,n]).last().then(res=>{
                        if(res){
                            let d = LoadData.wrap(res);
                            let seas = this.seasons[n] = new Season(this,d);
                            this.expireSeasonTimer(n);
                            this.seasonsBusyLoading[n] = undefined;
                            seas.lastAccessed = moment().valueOf();
                            return seas;
                        }else return undefined;
                    });
                },'Retrieving Season...');
            }
        }
        if(season) season.lastAccessed = moment().valueOf();
        else if(loadedRequired) throw new Error(LOADED_SEASON_REQUIRED_ERROR);
        if(callback instanceof Function) promise.then(callback);
        else if(callback) return promise;
        return season;
    }

    seasonUnloadable(n){
        n = parseInt(n);
        if(!this.seasons[n]) return false;
        let s = this.seasons[n];
        let v = this.getSeason(viewTick);
        for(let a of this.activeSystems) if(a.fetchStorm().originSeason()===n) return false;
        return !s.modified && n!==v && n!==v-1 && n!==this.getSeason(-1);
    }
    
    expireSeasonTimer(n){
        let f = ()=>{
            if(this.seasons[n]){
                if(moment().diff(this.seasons[n].lastAccessed)>=LOADED_SEASON_EXPIRATION && this.seasonUnloadable(n)) this.seasons[n] = undefined;
                else this.expireSeasonTimer(n);
            }
        };
        this.seasonExpirationTimers[n] = setTimeout(f,LOADED_SEASON_EXPIRATION);
    }

    // hard-coded definition of earth map sub-basins (could use a data-driven approach but this codebase is now beyond forsaken so why bother)
    defineEarthSubBasins(){
        const ids = EARTH_SB_IDS;
        this.addSubBasin(ids.world, undefined, 'World');
        this.addSubBasin(ids.nhem, undefined, 'Northern Hemisphere', ids.world);
        this.addSubBasin(ids.shem, undefined, 'Southern Hemisphere', ids.world);
        this.addSubBasin(ids.atl, undefined, 'Atlantic', ids.nhem,
            Scale.saffirSimpson.clone(),
            DesignationSystem.atlantic.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.atlland, undefined, 'Atl Land (technical)', ids.atl);
        this.addSubBasin(ids.epac, undefined, 'Eastern Pacific', ids.nhem,
            Scale.saffirSimpson.clone(),
            DesignationSystem.easternPacific.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.epacland, undefined, 'EPac Land (technical)', ids.epac);
        this.addSubBasin(ids.cpac, undefined, 'Central Pacific', ids.epac,
            undefined,
            DesignationSystem.centralPacific.clone().setCrossingModes(DESIG_CROSSMODE_KEEP, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.wpac, undefined, 'Western Pacific', ids.nhem,
            Scale.JMA.clone(),
            DesignationSystem.westernPacific.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.pagasa, undefined, 'PAGASA AoR', ids.wpac,
            undefined,
            DesignationSystem.PAGASA.clone()
            );
        this.addSubBasin(ids.nio, undefined, 'North Indian Ocean', ids.nhem,
            Scale.IMD.clone(),
            DesignationSystem.northIndianOcean.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.bob, undefined, 'Bay of Bengal', ids.nio,
            undefined,
            new DesignationSystem({
                prefix: 'BOB ',
                numCross: DESIG_CROSSMODE_KEEP
            })
            );
        this.addSubBasin(ids.arb, undefined, 'Arabian Sea', ids.nio,
            undefined,
            new DesignationSystem({
                prefix: 'ARB ',
                numCross: DESIG_CROSSMODE_KEEP
            })
            );
        this.addSubBasin(ids.nioland, undefined, 'LAND (NIO)', ids.nio,
            undefined,
            new DesignationSystem({
                prefix: 'LAND ',
                numCross: DESIG_CROSSMODE_KEEP
            })
            );
        this.addSubBasin(ids.medi, undefined, 'Mediterranean Sea', ids.nhem,
            undefined,
            DesignationSystem.mediterranean.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.aus, undefined, 'Australian Region', ids.shem,
            Scale.australian.clone(),
            DesignationSystem.australianRegionBoM.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.jakarta, undefined, 'TCWC Jakarta AoR', ids.aus,
            undefined,
            DesignationSystem.australianRegionJakarta.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.pm, undefined, 'TCWC Port Moresby AoR', ids.aus,
            undefined,
            DesignationSystem.australianRegionPortMoresby.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.swio, undefined, 'South-West Indian Ocean', ids.shem,
            Scale.southwestIndianOcean.clone(),
            DesignationSystem.southWestIndianOcean.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.spac, undefined, 'South Pacific', ids.shem,
            Scale.australian.clone(),
            DesignationSystem.southPacific.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
        this.addSubBasin(ids.satl, undefined, 'South Atlantic', ids.shem,
            undefined,
            DesignationSystem.southAtlantic.clone().setCrossingModes(undefined, DESIG_CROSSMODE_KEEP)
            );
    }

    save(){
        let reqSeasons = [];
        for(let k in this.seasons){
            if(this.seasons[k] && this.seasons[k].modified){
                let seas = this.seasons[k];
                for(let i=0;i<seas.systems.length;i++){
                    if(seas.systems[i] instanceof StormRef){
                        reqSeasons.push(this.fetchSeason(seas.systems[i].season,false,false,true));
                    }
                }
            }
        }
        return Promise.all(reqSeasons).then(()=>{
            let obj = {};
            obj.format = SAVE_FORMAT;
            let b = obj.value = {};
            b.activeSystems = [];
            for(let a of this.activeSystems){
                b.activeSystems.push(a.save());
            }
            b.envData = {};
            for(let f of this.env.fieldList){
                let fd = b.envData[f] = {};
                fd.version = this.env.fields[f].version;
                fd.accurateAfter = this.env.fields[f].accurateAfter;
                let d = fd.noiseData = [];
                for(let c of this.env.fields[f].noise){
                    d.push(c.save());
                }
            }
            b.subBasins = {};
            for(let i in this.subBasins){
                let s = this.subBasins[i];
                if(s instanceof SubBasin) b.subBasins[i] = s.save();
            }
            b.flags = 0;
            b.flags |= 0;   // former hyper mode
            b.flags <<= 1;
            b.flags |= this.godMode;
            b.flags <<= 1;
            b.flags |= this.SHem;
            for(let p of [
                'mapType',
                'tick',
                'seed',
                'startYear',
                'actMode'
            ]) b[p] = this[p];
            return db.transaction('rw',db.saves,db.seasons,()=>{
                db.saves.put(obj,this.saveName);
                for(let k in this.seasons){
                    if(this.seasons[k] && this.seasons[k].modified){
                        let seas = {};
                        seas.format = SAVE_FORMAT;
                        seas.saveName = this.saveName;
                        seas.season = parseInt(k);
                        seas.value = this.seasons[k].save();
                        let cur = db.seasons.where('[saveName+season]').equals([this.saveName,seas.season]);
                        cur.count().then(c=>{
                            if(c>1){
                                cur.delete().then(()=>{
                                    db.seasons.put(seas);
                                });
                            }else if(c===1) cur.modify((s,ref)=>{
                                ref.value = seas;
                            });
                            else db.seasons.put(seas);
                        });
                    }
                }
            }).then(()=>{
                this.lastSaved = this.tick;
                for(let k in this.seasons){
                    if(this.seasons[k]) this.seasons[k].modified = false;
                }
            });
        }).catch(e=>{
            console.warn("Could not save due to an error");
            console.error(e);
        });
    }

    load(){
        return waitForAsyncProcess(()=>{
            let mapImg;
            return db.saves.get(this.saveName).then(res=>{
                if(res && res.format>=EARLIEST_COMPATIBLE_FORMAT){
                    let data = LoadData.wrap(res);
                    let oldhyper;
                    let envData;
                    let oldNameList;
                    let oldSeqNameIndex;
                    let oldHypoCats;
                    let oldHurricaneStrengthTerm;
                    if(data.format>=FORMAT_WITH_INDEXEDDB){
                        let obj = data.value;
                        let flags = obj.flags;
                        this.SHem = flags & 1;
                        flags >>= 1;
                        this.godMode = flags & 1;
                        flags >>= 1;
                        oldhyper = flags & 1;
                        this.actMode = obj.actMode;
                        if(this.actMode === undefined){
                            if(oldhyper)
                                this.actMode = SIM_MODE_HYPER;
                            else
                                this.actMode = SIM_MODE_NORMAL;
                        }
                        this.mapType = obj.mapType;
                        for(let a of obj.activeSystems){
                            this.activeSystems.push(new ActiveSystem(this,data.sub(a)));
                        }
                        envData = data.sub(obj.envData);
                        if(obj.subBasins){
                            for(let i in obj.subBasins){
                                let s = obj.subBasins[i];
                                if(typeof s === "object") this.addSubBasin(i,data.sub(s));
                            }
                        }
                        for(let p of [
                            'tick',
                            'seed',
                            'startYear'
                        ]) this[p] = obj[p];
                        if(obj.nameList) oldNameList = obj.nameList;
                        if(obj.sequentialNameIndex!==undefined) oldSeqNameIndex = obj.sequentialNameIndex;
                        if(obj.hypoCats) oldHypoCats = obj.hypoCats;
                        if(obj.hurricaneStrengthTerm!==undefined) oldHurricaneStrengthTerm = obj.hurricaneStrengthTerm;
                        this.lastSaved = this.tick;
                    }else{  // localstorage format backwards compatibility
                        let str = data.value.str;
                        let format = data.format;
                        let names = data.value.names;
                        if(str){
                            let parts = str.split(";");
                            let arr = decodeB36StringArray(parts.pop());
                            let flags = arr.pop() || 0;
                            this.startYear = arr.pop();
                            this.seed = arr.pop() || moment().valueOf();
                            this.lastSaved = this.tick = arr.pop() || 0;
                            oldSeqNameIndex = arr.pop();
                            oldHurricaneStrengthTerm = arr.pop() || 0;
                            this.mapType = arr.pop() || 0;
                            this.SHem = flags & 1;
                            flags >>= 1;
                            this.godMode = flags & 1;
                            flags >>= 1;
                            oldhyper = flags & 1;
                            if(oldhyper)
                                this.actMode = SIM_MODE_HYPER;
                            else
                                this.actMode = SIM_MODE_NORMAL;
                            if(this.startYear===undefined) this.startYear = this.SHem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR;
                            if(names){
                                names = names.split(";");
                                if(names[0].indexOf(",")>-1){
                                    for(let i=0;i<names.length;i++){
                                        names[i] = names[i].split(",");
                                    }
                                    if(names[0][0]==="") names[0].shift();
                                }
                                oldNameList = names;
                            }
                            if(oldSeqNameIndex===undefined) oldSeqNameIndex = typeof oldNameList[0] === "string" ? 0 : -1;
                            let envLoadData = parts.pop();
                            if(envLoadData) envData = data.sub(envLoadData.split(','));
                            let activeSystemData = parts.pop();
                            if(activeSystemData){
                                activeSystemData = activeSystemData.split(",");
                                while(activeSystemData.length>0) this.activeSystems.push(new ActiveSystem(this,data.sub(activeSystemData.pop())));
                            }
                            if(format<FORMAT_WITH_SAVED_SEASONS) this.lastSaved = this.tick = 0; // resets tick to 0 in basins test-saved in versions prior to full saving including seasons added
                        }
                    }
                    if(MAP_TYPES[this.mapType].form === 'earth'){
                        this.mainSubBasin = MAP_TYPES[this.mapType].mainSubBasin;
                        if(data.format < FORMAT_WITH_EARTH_SUBBASINS){
                            let loadedSubBasins = this.subBasins;
                            this.subBasins = {};
                            this.defineEarthSubBasins();
                            for(let [oldId, newId] of updateEarthSubBasinIds(this.mapType)){
                                if(loadedSubBasins[oldId]){
                                    let sb = this.subBasins[newId];
                                    sb.setDesignationSystem(loadedSubBasins[oldId].designationSystem);
                                    sb.scale = loadedSubBasins[oldId].scale;
                                }
                            }
                        }
                    }
                    this.env.init(envData);
                    if(SEASON_CURVE[this.actMode])
                        seasonCurve = window[SEASON_CURVE[this.actMode]];
                    else
                        seasonCurve = window[SEASON_CURVE.default];
                    if(oldNameList){
                        let desSys = DesignationSystem.convertFromOldNameList(oldNameList);
                        if(!desSys.naming.annual)
                            desSys.naming.continuousNameIndex = oldSeqNameIndex;
                        if(!this.subBasins[this.mainSubBasin])
                            this.addSubBasin(this.mainSubBasin);
                        let sb = this.subBasins[this.mainSubBasin];
                        if(sb instanceof SubBasin)
                            sb.setDesignationSystem(desSys);
                    }
                    if(data.format<FORMAT_WITH_SCALES){
                        if(!this.subBasins[this.mainSubBasin])
                            this.addSubBasin(this.mainSubBasin);
                        let sb = this.subBasins[this.mainSubBasin];
                        if(sb instanceof SubBasin){
                            if(oldHypoCats) sb.scale = Scale.extendedSaffirSimpson.clone();
                            else sb.scale = Scale.saffirSimpson.clone();
                            if(oldHurricaneStrengthTerm!==undefined) sb.scale.flavor(oldHurricaneStrengthTerm===0 ? 2 : oldHurricaneStrengthTerm-1);
                        }
                    }
                }else{
                    let t = 'Could not load basin';
                    console.error(t);
                    alert(t);
                }
                return this;
            }).then(b=>{
                if(MAP_TYPES[b.mapType].form === 'pixelmap' || MAP_TYPES[b.mapType].form === 'earth'){
                    let path;
                    if(MAP_TYPES[b.mapType].form === 'earth')
                        path = EARTH_MAP_PATH;
                    else
                        path = MAP_TYPES[b.mapType].path;
                    return loadImg(path).then(img=>{
                        img.loadPixels();
                        mapImg = img;
                        return b;
                    });
                }
                return b;
            }).then(b=>{
                noiseSeed(b.seed);
                land = new Land(b, mapImg);
                return b.fetchSeason(-1,true,false,true).then(s=>{
                    let arr = [];
                    for(let i=0;i<s.systems.length;i++){
                        let r = s.systems[i];
                        if(r instanceof StormRef && (r.lastApplicableAt===undefined || r.lastApplicableAt>=b.tick || simSettings.trackMode===2)){
                            arr.push(b.fetchSeason(r.season,false,false,true));
                        }
                    }
                    return Promise.all(arr);
                });
            }).then(()=>this);
        },'Loading Basin...').catch(e=>{
            console.error(e);
        });
    }

    saveAs(newName){
        let oldName = this.saveName;
        return Basin.deleteSave(newName,()=>{
            return db.transaction('rw',db.saves,db.seasons,()=>{
                db.saves.get(oldName).then(res=>{
                    db.saves.put(res,newName);
                });
                db.seasons.where('saveName').equals(oldName).modify(v=>{
                    db.seasons.put({
                        format: v.format,
                        saveName: newName,
                        season: v.season,
                        value: v.value
                    });
                });
            }).then(()=>{
                this.saveName = newName;
                this.save();
            });
        });
    }

    static deleteSave(name,callback){
        return db.transaction('rw',db.saves,db.seasons,()=>{
            db.saves.delete(name);
            db.seasons.where('saveName').equals(name).delete();
        }).then(callback).catch(e=>{
            console.error(e);
        });
    }
}

class Season{
    constructor(basin,loaddata){
        if(basin instanceof Basin) this.basin = basin;
        this.systems = [];
        this.envData = {};
        this.idSystemCache = {};
        this.subBasinStats = {};
        this.totalSystemCount = 0;
        // this.envRecordStarts = 0;
        this.modified = true;
        this.lastAccessed = moment().valueOf();
        if(loaddata instanceof LoadData) this.load(loaddata);
    }

    addSystem(s){
        this.systems.push(s);
        if(s.current) s.id = this.totalSystemCount++;
        this.modified = true;
    }

    fetchSystemById(id){
        if(this.idSystemCache[id]) return this.idSystemCache[id];
        for(let i=0;i<this.systems.length;i++){
            let s = this.systems[i];
            if(s.id===id){
                this.idSystemCache[id] = s;
                return s;
            }
        }
        return null;
    }

    fetchSystemAtIndex(i,lazy){
        if(this.systems[i] instanceof StormRef){
            if(lazy){
                let r = this.systems[i];
                if(r.lastApplicableAt===undefined || r.lastApplicableAt>=viewTick || simSettings.trackMode===2) return r.fetch();
                return undefined;
            }else return this.systems[i].fetch();
        }
        return this.systems[i];
    }

    *forSystems(lazy){
        for(let i=0;i<this.systems.length;i++){
            let s = this.fetchSystemAtIndex(i,lazy);
            if(s) yield s;
        }
    }

    stats(sub){
        let s = this.subBasinStats[sub];
        if(s instanceof SeasonStats) return s;
        let n = this.subBasinStats[sub] = new SeasonStats(this.basin,sub);
        return n;
    }

    get_season_year(){
        // bad hacky way at getting the season year
        for(let y in this.basin.seasons){
            if(this.basin.seasons[y] === this)
                return +y;
        }
    }

    save(forceStormRefs){
        let basin = this.basin;
        let val = {};
        // for(let p of [
        //     'totalSystemCount',
        //     'envRecordStarts'
        // ]) val[p] = this[p];
        val.totalSystemCount = this.totalSystemCount;
        val.stats = {};
        for(let sub in this.subBasinStats){
            let s = this.subBasinStats[sub];
            if(s instanceof SeasonStats) val.stats[sub] = s.save();
        }
        val.envData = {};
        for(let f of basin.env.fieldList){
            let fd = val.envData[f] = {};
            for(let i=0;i<basin.env.fields[f].noise.length;i++){
                let nd = fd[i] = {};
                let x = [];
                let y = [];
                let z = [];
                for(let e of this.envData[f][i].val){
                    x.push(e.x);
                    y.push(e.y);
                    z.push(e.z);
                }
                nd.x = new Float32Array(x);
                nd.y = new Float32Array(y);
                nd.z = new Float32Array(z);
                nd.recordStart = this.envData[f][i].recordStart;
            }
        }
        val.systems = [];
        for(let i=0;i<this.systems.length;i++){
            let s = this.systems[i];
            if(s instanceof StormRef && (forceStormRefs || s.fetch() && (s.fetch().inBasinTC || s.fetch().current))){
                val.systems.push({isRef:true,val:s.save()});
            }else if(s.inBasinTC || s.current){
                val.systems.push({isRef:false,val:s.save()});
            }
        }
        return val;
    }

    load(data){
        let basin = this.basin;
        if(data instanceof LoadData && data.format >= EARLIEST_COMPATIBLE_FORMAT && data.format <= SAVE_FORMAT){
            let oldStats = {};
            if(data.format>=FORMAT_WITH_INDEXEDDB){
                let obj = data.value;
                // for(let p of [
                //     'totalSystemCount',
                //     'envRecordStarts'
                // ]) this[p] = obj[p] || 0;
                this.totalSystemCount = obj.totalSystemCount || 0;
                if(data.format<FORMAT_WITH_SUBBASIN_SEASON_STATS){
                    for(let p of [
                        'depressions',
                        'namedStorms',
                        'hurricanes',
                        'majors',
                        'c5s',
                        'c8s',
                        'hypercanes',
                        'ACE',
                        'deaths',
                        'damage',
                        'landfalls'
                    ]) oldStats[p] = obj[p];
                }
                if(obj.stats){
                    if(data.format >= FORMAT_WITH_EARTH_SUBBASINS || MAP_TYPES[basin.mapType].form !== 'earth'){
                        for(let sub in obj.stats)
                            this.subBasinStats[sub] = new SeasonStats(basin, sub, data.sub(obj.stats[sub]));
                    }else{
                        for(let [oldSub, newSub] of updateEarthSubBasinIds(basin.mapType)){
                            if(obj.stats[oldSub])
                                this.subBasinStats[newSub] = new SeasonStats(basin, newSub, data.sub(obj.stats[oldSub]));
                        }
                    }
                }
                if(data.format>ENVDATA_COMPATIBLE_FORMAT && obj.envData){
                    for(let f of basin.env.fieldList){
                        if(obj.envData[f]){
                            let fd = this.envData[f] = {};
                            for(let i=0;i<basin.env.fields[f].noise.length;i++){
                                if(obj.envData[f][i]){
                                    fd[i] = {};
                                    let nd = fd[i].val = [];
                                    let sd = obj.envData[f][i];
                                    fd[i].recordStart = sd.recordStart || obj.envRecordStarts || 0;
                                    let x = [...sd.x];
                                    let y = [...sd.y];
                                    let z = [...sd.z];
                                    for(let j=0;j<x.length;j++){
                                        nd.push({
                                            x: x[j],
                                            y: y[j],
                                            z: z[j]
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                for(let i=0;i<obj.systems.length;i++){
                    let s = obj.systems[i];
                    if(s.isRef) this.systems.push(new StormRef(basin,data.sub(s.val)));
                    else{
                        let v = data.sub(s.val);
                        v.season = data.season;
                        this.systems.push(new Storm(basin,v));
                    }
                }
            }else{  // localstorage format backwards compatibility
                let str = data.value;
                let mainparts = str.split(";");
                let stats = decodeB36StringArray(mainparts[0]);
                data.format = stats.pop();
                if(data.format===undefined){
                    this.envData = null;
                    return;
                }
                let envRecordStarts = stats.pop() || 0;
                oldStats.damage = stats.pop()*DAMAGE_DIVISOR || 0;
                oldStats.deaths = stats.pop() || 0;
                oldStats.ACE = stats.pop()/ACE_DIVISOR || 0;
                oldStats.c5s = stats.pop() || 0;
                oldStats.majors = stats.pop() || 0;
                oldStats.hurricanes = stats.pop() || 0;
                oldStats.namedStorms = stats.pop() || 0;
                oldStats.depressions = stats.pop() || 0;
                this.totalSystemCount = stats.pop() || 0;
                if(data.format>=ENVDATA_COMPATIBLE_FORMAT && mainparts[1]!==""){
                    let e = mainparts[1].split(",");
                    let i = 0;
                    let mapR = r=>n=>map(n,0,ENVDATA_SAVE_MULT,-r,r);
                    for(let f of basin.env.fieldList){
                        for(let j=0;j<basin.env.fields[f].noise.length;j++,i++){
                            let c = basin.env.fields[f].noise[j];
                            let s = e[i].split(".");
                            let k = decodeB36StringArray(s[0]);
                            k = {x:k[0],y:k[1],z:k[2]};
                            let opts = {};
                            opts.h = opts.w = ENVDATA_SAVE_MULT;
                            let xyrange = (c.wobbleMax/c.zoom)*ADVISORY_TICKS;
                            let zrange = (c.zWobbleMax/c.zZoom)*ADVISORY_TICKS;
                            opts.mapY = opts.mapX = mapR(xyrange);
                            opts.mapZ = mapR(zrange);
                            let m = decodePointArray(s[1],opts);
                            for(let n=0;n<m.length;n++){
                                let p1;
                                if(n===0) p1 = k;
                                else p1 = m[n-1];
                                let p2 = m[n];
                                m[n] = {
                                    x: p1.x + p2.x,
                                    y: p1.y + p2.y,
                                    z: p1.z + p2.z
                                };
                            }
                            m.unshift(k);
                            if(!this.envData[f]) this.envData[f] = {};
                            this.envData[f][j] = {recordStart: envRecordStarts, val: m};
                        }
                    }
                }else this.envData = null;
                let storms = mainparts[2];
                for(let i=0,i1=0;i1<storms.length;i=i1){
                    i1 = storms.slice(i+1).search(/[~,]/g);
                    i1 = i1<0 ? storms.length : i+1+i1;
                    let s = storms.slice(i,i1);
                    if(s.charAt(0)==="~") this.systems.push(new StormRef(basin,data.sub(s.slice(1))));
                    else if(s.charAt(0)===","){
                        let v = data.sub(s.slice(1));
                        v.season = data.season;
                        this.systems.push(new Storm(basin,v));
                    }
                }
            }
            if(data.format<FORMAT_WITH_SUBBASIN_SEASON_STATS){
                let s = this.stats(this.basin.mainSubBasin);
                for(let p of [
                    'ACE',
                    'deaths',
                    'damage',
                    'landfalls'
                ]) s[p] = oldStats[p] || 0;
                let cCounters = s.classificationCounters;
                cCounters[0] = oldStats.depressions || 0;
                cCounters[1] = oldStats.namedStorms || 0;
                cCounters[2] = oldStats.hurricanes || 0;
                cCounters[4] = oldStats.majors || 0;
                cCounters[7] = oldStats.c5s || 0;
                if(basin.getScale(this.basin.mainSubBasin).classifications.length>8){
                    cCounters[10] = oldStats.c8s || 0;
                    cCounters[13] = oldStats.hypercanes || 0;
                }
                let dCounters = s.designationCounters;
                dCounters.number = oldStats.depressions || 0;
                dCounters.name = oldStats.namedStorms || 0;
            }
            for(let s in this.subBasinStats)
                this.subBasinStats[s].update_most_intense(this);
            if(data.format===SAVE_FORMAT) this.modified = false;
            /* else if(simSettings.doAutosave){
                db.transaction('rw',db.seasons,()=>{
                    let seas = {};
                    seas.format = SAVE_FORMAT;
                    seas.saveName = data.saveName;
                    seas.season = data.season;
                    seas.value = this.save(true);
                    let cur = db.seasons.where('[saveName+season]').equals([data.saveName,data.season]);
                    cur.count().then(c=>{
                        if(c>0) cur.modify((s,ref)=>{
                            ref.value = seas;
                        });
                        else db.seasons.put(seas);
                    });
                }).then(()=>{
                    this.modified = false;
                }).catch(e=>{
                    console.error(e);
                });
            } */
        }else this.envData = null;
    }
}

class SeasonStats{
    constructor(basin,sub,data){
        this.basin = basin instanceof Basin && basin;
        this.subBasinId = sub;
        if(this.basin) this.subBasin = this.basin.subBasins[this.subBasinId];

        this.ACE = 0;
        this.deaths = 0;
        this.damage = 0;
        this.landfalls = 0;

        this.classificationCounters = {};       // counters for systems by classification on the sub-basin's scale (e.g. tropical depression, tropical storm, etc.)
        let clsns = this.basin.getScale(this.subBasinId).classifications.length;
        for(let i=0;i<clsns;i++) this.classificationCounters[i] = 0;

        this.designationCounters = {};
        this.designationCounters.number = 0;    // counter for numerical designations
        this.designationCounters.name = 0;      // counter for annual-based name designations

        this.most_intense = undefined;

        if(data instanceof LoadData) this.load(data);
    }

    addACE(v){
        this.ACE = round((this.ACE + v) * ACE_DIVISOR) / ACE_DIVISOR;
    }

    update_most_intense(season, storm, data){
        if(this.most_intense === undefined){
            let lowest_pressure;
            let record_holder;
            let year = season.get_season_year();
            for(let s of season.forSystems()){
                if(s.inBasinTC){
                    for(let i = 0; i < s.record.length; i++){
                        let d = s.record[i];
                        let in_subbasin = false;
                        let in_year = this.basin.getSeason(s.get_tick_from_record_index(i)) === year;
                        for(let sbid of this.basin.forSubBasinChain(land.getSubBasin(d.coord()))){
                            if(sbid === +this.subBasinId)
                                in_subbasin = true;
                        }
                        if(in_subbasin && in_year && tropOrSub(d.type) && (lowest_pressure === undefined || d.pressure < lowest_pressure)){
                            lowest_pressure = d.pressure;
                            record_holder = s;
                        }
                    }
                }
            }
            if(record_holder)
                this.most_intense = new StormRef(this.basin, record_holder);
        }
        if(storm && data){
            if(this.most_intense instanceof StormRef){
                let most_intense_storm = this.most_intense.fetch();
                if(data.pressure < most_intense_storm.peak.pressure)
                    this.most_intense = new StormRef(this.basin, storm);
            }else
                this.most_intense = new StormRef(this.basin, storm);
        }
    }

    save(){
        let d = {};
        if(this.subBasin instanceof SubBasin ? !this.subBasin.outBasin() : this.subBasinId!==DEFAULT_OUTBASIN_SUBBASIN){
            for(let p of [
                'ACE',
                'deaths',
                'damage',
                'landfalls'
            ]) d[p] = this[p];
            d.cCounters = {};
            for(let i in this.classificationCounters) d.cCounters[i] = this.classificationCounters[i];
            if(this.most_intense)
                d.most_intense = this.most_intense.save();
        }
        d.dCounters = {};
        d.dCounters.number = this.designationCounters.number;
        d.dCounters.name = this.designationCounters.name;
        return d;
    }

    load(data){
        if(data instanceof LoadData){
            let d = data.value;
            if(this.subBasin instanceof SubBasin ? !this.subBasin.outBasin() : this.subBasinId!==DEFAULT_OUTBASIN_SUBBASIN){
                for(let p of [
                    'ACE',
                    'deaths',
                    'damage',
                    'landfalls'
                ]) this[p] = d[p];
                if(d.cCounters){
                    for(let i in d.cCounters){
                        if(data.format>=FORMAT_WITH_SCALES) this.classificationCounters[i] = d.cCounters[i];
                        else{   // convert pre-v0.2 values
                            this.classificationCounters[Scale.convertOldValue(+i)] = d.cCounters[i];
                            if(i==='5') this.classificationCounters['6'] = d.cCounters[i];
                        }
                    }
                }
                if(d.most_intense)
                    this.most_intense = new StormRef(this.basin, data.sub(d.most_intense));
            }
            if(d.dCounters){
                this.designationCounters.number = d.dCounters.number;
                this.designationCounters.name = d.dCounters.name;
            }
        }
    }
}

class SubBasin{
    constructor(basin,id,data,dName,parent,scale,desSys){
        this.basin = basin instanceof Basin && basin;
        this.id = id || DEFAULT_MAIN_SUBBASIN;
        this.parent = undefined;
        if(parent) this.parent = parent;
        else if(this.id!==DEFAULT_MAIN_SUBBASIN && this.id!==DEFAULT_OUTBASIN_SUBBASIN && parent!==false) this.parent = DEFAULT_MAIN_SUBBASIN;
        this.displayName = undefined;
        if(dName) this.displayName = dName;
        this.designationSystem = undefined;
        this.scale = undefined;
        this.setDesignationSystem(desSys);
        if(scale instanceof Scale) this.scale = scale;
        this.mapOutline = undefined;
        if(!this.outBasin() && this.id!==DEFAULT_MAIN_SUBBASIN){
            let {fullW, fullH} = fullDimensions();
            this.mapOutline = createBuffer(fullW, fullH, true);
            this.mapOutline.noStroke();
        }
        if(data instanceof LoadData) this.load(data);
    }

    setDesignationSystem(ds){
        if(ds instanceof DesignationSystem){
            ds.setSubBasin(this);
            this.designationSystem = ds;
        }
    }

    outBasin(origin){
        if(this.id===this.basin.mainSubBasin) return false;
        if(this.parent===this.basin.mainSubBasin) return false;
        if(this.parent===undefined) return true;
        if(this.parent===origin) return true;
        let p = this.basin.subBasins[this.parent];
        if(p instanceof SubBasin) return p.outBasin(origin || this.id);
        if(this.parent===DEFAULT_OUTBASIN_SUBBASIN) return true;
        return false;
    }

    getDisplayName(){
        if(this.displayName) return this.displayName;
        if(this.id===DEFAULT_MAIN_SUBBASIN) return 'Main Basin';
        return 'SubBasin ' + this.id;
    }

    *forParents(origin){
        if(this.id!==DEFAULT_MAIN_SUBBASIN && this.parent!==undefined && this.parent!==origin){
            yield this.parent;
            if(this.parent!==DEFAULT_MAIN_SUBBASIN){
                let p = this.basin.subBasins[this.parent];
                if(p instanceof SubBasin) yield* p.forParents(origin || this.id);
                else if(this.parent!==DEFAULT_OUTBASIN_SUBBASIN) yield DEFAULT_MAIN_SUBBASIN;
            }
        }
    }

    *forChain(){
        yield this.id;
        yield* this.forParents();
    }

    save(){
        let d = {};
        for(let p of [
            'parent',
            'displayName'
        ]) d[p] = this[p];
        d.desSys = undefined;
        d.scale = undefined;
        if(this.designationSystem instanceof DesignationSystem) d.desSys = this.designationSystem.save();
        if(this.scale instanceof Scale) d.scale = this.scale.save();
        return d;
    }

    load(data){
        if(data instanceof LoadData){
            let d = data.value;
            for(let p of [
                'parent',
                'displayName'
            ]) this[p] = d[p];
            if(d.desSys) this.setDesignationSystem(new DesignationSystem(data.sub(d.desSys)));
            if(d.scale) this.scale = new Scale(data.sub(d.scale));
        }
    }
}

// saving/loading helpers

function setupDatabase(){
    db = new Dexie("cyclone-sim");
    db.version(1).stores({
        saves: '',
        seasons: '++,saveName,season',
        settings: ''
    });
    db.version(2).stores({
        saves: ',format',
        seasons: '++,format,saveName,[saveName+season]'
    });
}

class LoadData{
    constructor(format,value){
        this.format = format;
        this.value = value;
    }

    sub(v){
        return new LoadData(this.format,v);
    }

    static wrap(obj){
        let d = new LoadData(obj.format,obj.value);
        for(let k in obj){
            if(k!=='format' && k!=='value') d[k] = obj[k];
        }
        return d;
    }
}

// legacy localstorage decoders (for backwards compatibility)

function decodeB36StringArray(str){
    const R = SAVING_RADIX;
    let arr = [];
    let fl = str.slice(0,1);
    fl = parseInt(fl,R);
    if(fl>R/2) fl -= R;
    for(let i=1,runLen=0,run=0,nLen;i<str.length;i+=nLen,run++){
        if(run>=runLen){
            runLen = str.slice(i,++i);
            nLen = str.slice(i,++i);
            runLen = parseInt(runLen,R)+1;
            nLen = parseInt(nLen,R)+1;
            run = 0;
        }
        let n = str.slice(i,i+nLen);
        n = parseInt(n,R);
        n = n%2===0 ? n/2 : -(n-1)/2;
        n *= pow(R,fl);
        arr.push(n);
    }
    return arr;
}

function decodePoint(n,o){
    if(!o) o = {};
    let w = floor(o.w || WIDTH);
    let h = floor(o.h || HEIGHT);
    let z = floor(n/(w*h));
    n %= w*h;
    let y = floor(n/w);
    n %= w;
    let x = n;
    if(o.mapX instanceof Function) x = o.mapX(x);
    if(o.mapY instanceof Function) y = o.mapY(y);
    if(o.mapZ instanceof Function) z = o.mapZ(z);
    if(o.p5Vec) return createVector(x,y,z);
    return {x,y,z};
}

function decodePointArray(s,o){
    let arr = decodeB36StringArray(s);
    for(let i=0;i<arr.length;i++){
        arr[i] = decodePoint(arr[i],o);
    }
    return arr;
}

// earth sub-basin id converter (for pre-v0.4 saves)

function* updateEarthSubBasinIds(mapType){
    if(MAP_TYPES[mapType].form === 'earth'){
        const ids = EARTH_SB_IDS;
        yield [0, MAP_TYPES[mapType].mainSubBasin]; // main (sub-)basin
        // hardcoded conversion of special sub-basin ids by map type
        if(mapType === 7) // Eastern Pacific
            yield [128, ids.cpac];
        else if(mapType === 8) // Western Pacific
            yield [128, ids.pagasa];
        else if(mapType === 9){ // North Indian Ocean
            yield [128, ids.arb];
            yield [129, ids.bob];
        }else if(mapType === 10){ // Australian Region
            yield [128, ids.jakarta];
            yield [129, ids.pm];
        }
    }
}
class UI{
    constructor(parent,x,y,w,h,renderer,onclick,showing){
        if(parent instanceof UI){
            this.parent = parent;
            this.parent.children.push(this);
        }
        this.relX = x;
        this.relY = y;
        this.width = w;
        this.height = h;
        if(renderer instanceof Function) this.renderFunc = renderer;
        if(renderer instanceof Array){
            let [size, charLimit, enterFunc] = renderer;
            this.isInput = true;
            this.value = '';
            this.clickFunc = function(){
                // textInput.value = this.value;
                // if(charLimit) textInput.maxLength = charLimit;
                // else textInput.removeAttribute('maxlength');
                // textInput.focus();
                UI.inputData.value = this.value;
                UI.inputData.maxLength = charLimit;
                UI.inputData.cursor = UI.inputData.selectionStart = UI.inputData.selectionEnd = this.value.length;
                UI.focusedInput = this;
                if(onclick instanceof Function) onclick.call(this,UI.focusedInput===this);
            };
            this.textCanvas = createBuffer(this.width,this.height);
            this.renderFunc = function(s){
                s.input(size);
            };
            if(enterFunc) this.enterFunc = enterFunc;
        }else{
            this.clickFunc = onclick;
            this.isInput = false;
        }
        this.children = [];
        this.showing = showing===undefined ? true : showing;
        if(!this.parent) UI.elements.push(this);
    }

    getX(){
        if(this.parent) return this.parent.getX() + this.relX;
        return this.relX;
    }

    getY(){
        if(this.parent) return this.parent.getY() + this.relY;
        return this.relY;
    }

    render(){
        if(this.showing){
            translate(this.relX,this.relY);
            if(this.renderFunc) this.renderFunc(this.schematics());
            if(this.children.length===1){
                this.children[0].render();
            }else{
                for(let c of this.children){
                    push();
                    c.render();
                    pop();
                }
            }
        }
    }

    schematics(){
        let s = {};
        s.fullRect = ()=>{
            rect(0,0,this.width,this.height);
        };
        s.button = (txt,box,size,grey)=>{
            noStroke();
            if(box){
                fill(COLORS.UI.buttonBox);
                s.fullRect();
            }
            if(this.isHovered()){
                fill(COLORS.UI.buttonHover);
                s.fullRect();
            }
            if(grey) fill(COLORS.UI.greyText);
            else fill(COLORS.UI.text);
            textAlign(CENTER,CENTER);
            textSize(size || 18);
            text(txt,this.width/2,this.height/2);
        };
        s.input = (size)=>{
            fill(COLORS.UI.input);
            if(UI.focusedInput===this) stroke(COLORS.UI.text);
            else{
                if(this.isHovered()){
                    noStroke();
                    s.fullRect();
                    fill(COLORS.UI.buttonHover);
                }
                stroke(COLORS.UI.nonSelectedInput);
            }
            s.fullRect();
            let c = this.textCanvas;
            c.clear();
            c.noStroke();
            c.fill(COLORS.UI.text);
            c.textSize(size || 18);
            let t = UI.focusedInput===this ? /* textInput */UI.inputData.value : this.value;
            let xAnchor;
            if(UI.focusedInput===this){
                c.textAlign(LEFT,CENTER);
                let caret1X = c.textWidth(t.slice(0,/* textInput */UI.inputData.selectionStart));
                let caret2X = c.textWidth(t.slice(0,/* textInput */UI.inputData.selectionEnd));
                if(caret2X>this.width-5) xAnchor = this.width-5-caret2X;
                else xAnchor = 5;
                caret1X += xAnchor;
                caret2X += xAnchor;
                c.text(t,xAnchor,this.height/2);
                if(/* textInput */UI.inputData.selectionStart === /* textInput */UI.inputData.selectionEnd){
                    c.stroke(COLORS.UI.text);
                    c.noFill();
                    if(millis()%1000<500) c.line(caret1X,this.height/8,caret1X,7*this.height/8);
                }else{
                    c.rect(caret1X,this.height/8,caret2X-caret1X,3*this.height/4);
                    c.fill(COLORS.UI.input);
                    c.text(t.slice(/* textInput */UI.inputData.selectionStart, /* textInput */UI.inputData.selectionEnd), caret1X, this.height / 2);
                }
            }else{
                if(c.textWidth(t)>this.width-5){
                    c.textAlign(RIGHT,CENTER);
                    xAnchor = this.width-5;
                }else{
                    c.textAlign(LEFT,CENTER);
                    xAnchor = 5;
                }
                c.text(t,xAnchor,this.height/2);
            }
            image(c, 0, 0, this.width, this.height);
        };
        return s;
    }

    setBox(x,y,w,h){    // Should be used inside of the renderer function
        if(x===undefined) x = this.relX;
        if(y===undefined) y = this.relY;
        if(w===undefined) w = this.width;
        if(h===undefined) h = this.height;
        translate(x-this.relX,y-this.relY);
        this.relX = x;
        this.relY = y;
        this.width = w;
        this.height = h;
    }

    append(chain,...opts){
        if(chain!==false && this.children.length>chain) return this.children[chain].append(0,...opts);
        return new UI(this,...opts);
    }

    checkMouseOver(){
        if(this.showing){
            if(this.children.length>0){
                let cmo = null;
                for(let i=this.children.length-1;i>=0;i--){
                    cmo = this.children[i].checkMouseOver();
                    if(cmo) return cmo;
                }
            }
            let left = this.getX();
            let right = left + this.width;
            let top = this.getY();
            let bottom = top + this.height;
            if(this.clickFunc && getMouseX()>=left && getMouseX()<right && getMouseY()>=top && getMouseY()<bottom) return this;
        }
        return null;
    }

    isHovered(){
        return UI.mouseOver===this;     // onclick parameter in constructor is required in order for hovering to work; use any truthy non-function value if clicking the UI does nothing
    }

    clicked(){
        if(this.clickFunc instanceof Function) this.clickFunc();
    }

    show(){
        this.showing = true;
    }

    hide(){
        this.showing = false;
    }

    toggleShow(){
        this.showing = !this.showing;
    }

    remove(){
        let mouseIsHere = false;
        if(this.checkMouseOver()){
            UI.mouseOver = undefined;
            mouseIsHere = true;
        }
        if(this.parent){
            for(let i=this.parent.children.length-1;i>=0;i--){
                if(this.parent.children[i]===this){
                    this.parent.children.splice(i,1);
                    break;
                }
            }
        }else{
            for(let i=UI.elements.length-1;i>=0;i--){
                if(UI.elements[i]===this){
                    UI.elements.splice(i,1);
                    break;
                }
            }
        }
        if(mouseIsHere) UI.updateMouseOver();
    }

    dropChildren(){
        let mouseIsHere = false;
        if(this.checkMouseOver()){
            UI.mouseOver = undefined;
            mouseIsHere = true;
        }
        this.children = [];
        if(mouseIsHere) UI.updateMouseOver();
    }
}

UI.elements = [];

UI.renderAll = function(){
    for(let u of UI.elements){
        push();
        u.render();
        pop();
    }
};

UI.mouseOver = undefined;
UI.focusedInput = undefined;
UI.inputData = {
    value: '',
    cursor: 0,
    selectionStart: 0,
    selectionEnd: 0,
    maxLength: undefined,
    insert: ''
};

UI.setInputCursorPosition = function(i, isSelecting){
    let anchor;
    if(UI.inputData.cursor === UI.inputData.selectionEnd)
        anchor = UI.inputData.selectionStart;
    else
        anchor = UI.inputData.selectionEnd;
    UI.inputData.cursor = i;
    if(isSelecting){
        UI.inputData.selectionStart = Math.min(i, anchor);
        UI.inputData.selectionEnd = Math.max(i, anchor);
    }else{
        UI.inputData.selectionStart = i;
        UI.inputData.selectionEnd = i;
    }
};

UI.updateMouseOver = function(){
    for(let i=UI.elements.length-1;i>=0;i--){
        let u = UI.elements[i];
        let mo = u.checkMouseOver();
        if(mo){
            UI.mouseOver = mo;
            return mo;
        }
    }
    UI.mouseOver = null;
    return null;
};

UI.click = function(){
    UI.updateMouseOver();
    if(UI.mouseOver === UI.focusedInput)
        return false;
    else if(UI.focusedInput){
        UI.focusedInput.value = UI.inputData.value;
        UI.focusedInput = undefined;
    }
    if(UI.mouseOver){
        UI.mouseOver.clicked();
        return true;
    }
    return false;
};

UI.viewBasin = undefined;
// UI.viewTick = undefined;

// Definitions for all UI elements

UI.init = function(){
    // hoist!

    let yearselbox;

    // "scene" wrappers

    mainMenu = new UI(null,0,0,WIDTH,HEIGHT);
    basinCreationMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,function(){
        yearselbox.enterFunc();
    },false);
    basinCreationMenuAdvanced = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    loadMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    settingsMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    let desigSystemEditor = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    primaryWrapper = new UI(null,0,0,WIDTH,HEIGHT,function(s){
        if(UI.viewBasin instanceof Basin){
            let basin = UI.viewBasin;
            if(basin.viewingPresent()) for(let S of basin.activeSystems) S.fetchStorm().renderIcon();
            else{
                let seas = basin.fetchSeason(viewTick,true);
                if(seas) for(let S of seas.forSystems(true)) S.renderIcon();
            }
    
            if(!land.drawn){
                renderToDo = land.draw();
                return;
            }
            let drawMagGlass = ()=>{
                if(simSettings.showMagGlass){
                    let magMeta = buffers.get(magnifyingGlass);
                    image(
                        magnifyingGlass,
                        getMouseX()-magMeta.baseWidth/2,
                        getMouseY()-magMeta.baseHeight/2,
                        magMeta.baseWidth,
                        magMeta.baseHeight
                    );
                }
            };
            drawBuffer(outBasinBuffer);
            if(basin.env.displaying>=0 && basin.env.layerIsOceanic){
                drawBuffer(envLayer);
                drawMagGlass();
            }
            drawBuffer(landBuffer);
            if(simSettings.snowLayers){
                if(land.snowDrawn) drawBuffer(snow[floor(map(seasonCurve(viewTick,SNOW_SEASON_OFFSET),-1,1,0,simSettings.snowLayers*10))]);
                else renderToDo = land.drawSnow();
            }
            if(simSettings.useShadows){
                if(land.shaderDrawn) drawBuffer(landShadows);
                else renderToDo = land.drawShader();
            }
            if(basin.env.displaying>=0 && !basin.env.layerIsOceanic){
                drawBuffer(envLayer);
                drawMagGlass();
                if(!basin.env.layerIsVector) drawBuffer(coastLine);
            }
            // let sub = land.getSubBasin(getMouseX(),getMouseY());
            // if(basin.subBasins[sub] instanceof SubBasin && basin.subBasins[sub].mapOutline) drawBuffer(basin.subBasins[sub].mapOutline);   // test
            drawBuffer(tracks);
            drawBuffer(forecastTracks);
            drawBuffer(stormIcons);
        }
    },function(){
        helpBox.hide();
        sideMenu.hide();
        seedBox.hide();
        if(UI.viewBasin instanceof Basin){
            let basin = UI.viewBasin;
            if(basin.godMode && keyIsPressed && basin.viewingPresent()) {
                if(['l','x','d','D','s','S','1','2','3','4','5','6','7','8','9','0','y'].includes(key))
                    basin.spawnArchetype(key,getMouseX(),getMouseY());
                // let g = {x: getMouseX(), y: getMouseY()};
                // if(key === "l" || key === "L"){
                //     g.sType = "l";
                // }else if(key === "d"){
                //     g.sType = "d";
                // }else if(key === "D"){
                //     g.sType = "sd";
                // }else if(key === "s"){
                //     g.sType = "s";
                // }else if(key === "S"){
                //     g.sType = "ss";
                // }else if(key === "1"){
                //     g.sType = "1";
                // }else if(key === "2"){
                //     g.sType = "2";
                // }else if(key === "3"){
                //     g.sType = "3";
                // }else if(key === "4"){
                //     g.sType = "4";
                // }else if(key === "5"){
                //     g.sType = "5";
                // }else if(key === "6"){
                //     g.sType = "6";
                // }else if(key === "7"){
                //     g.sType = "7";
                // }else if(key === "8"){
                //     g.sType = "8";
                // }else if(key === "9"){
                //     g.sType = "9";
                // }else if(key === "0"){
                //     g.sType = "10";
                // }else if(key === "y" || key === "Y"){
                //     g.sType = "y";
                // }else if(key === "x" || key === "X"){
                //     g.sType = "x";
                // }else return;
                // basin.spawn(false,g);
            }else if(basin.viewingPresent()){
                let mVector = createVector(getMouseX(),getMouseY());
                for(let i=basin.activeSystems.length-1;i>=0;i--){
                    let s = basin.activeSystems[i].fetchStorm();
                    let p = s.getStormDataByTick(viewTick,true).pos;
                    if(p.dist(mVector)<DIAMETER){
                        selectStorm(s);
                        refreshTracks(true);
                        return;
                    }
                }
                selectStorm();
                refreshTracks(true);
            }else{
                let vSeason = basin.fetchSeason(viewTick,true);
                if(vSeason){
                    let mVector = createVector(getMouseX(),getMouseY());
                    for(let i=vSeason.systems.length-1;i>=0;i--){
                        let s = vSeason.fetchSystemAtIndex(i);
                        if(s && s.aliveAt(viewTick)){
                            let p = s.getStormDataByTick(viewTick).pos;
                            if(p.dist(mVector)<DIAMETER){
                                selectStorm(s);
                                refreshTracks(true);
                                return;
                            }
                        }
                    }
                    selectStorm();
                    refreshTracks(true);
                }
            }
        }
    },false);
    areYouSure = new UI(null,0,0,WIDTH,HEIGHT,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
    },true,false);

    // main menu

    mainMenu.append(false,WIDTH/2,HEIGHT/4,0,0,function(s){  // title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text(TITLE,0,0);
        textSize(18);
        textStyle(ITALIC);
        text("Simulate your own monster storms!",0,40);
    });

    mainMenu.append(false,WIDTH/2-100,HEIGHT/2-20,200,40,function(s){    // "New Basin" button
        s.button('New Basin',true,24);
    },function(){
        mainMenu.hide();
        basinCreationMenu.show();
    }).append(false,0,60,200,40,function(s){     // load button
        s.button('Load Basin',true,24);
    },function(){
        mainMenu.hide();
        loadMenu.show();
        loadMenu.refresh();
    }).append(false,0,60,200,40,function(s){     // settings menu button
        s.button('Settings',true,24);
    },function(){
        mainMenu.hide();
        settingsMenu.show();
    });

    // basin creation menu

    let newBasinSettings = {};
    newBasinSettings.mapType = 6; // default to Atlantic
    let advancedBasinSettings = {};
    Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);

    basinCreationMenu.append(false,WIDTH/2,HEIGHT/16,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("New Basin Settings",0,0);
    });

    let basinCreationMenuButtonSpacing = 36;
    let basinCreationMenuButtonHeights = 28;
    let basinCreationMenuButtonWidths = 400;

    let maptypesel = basinCreationMenu.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,HEIGHT/8,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Map type Selector
        let maptype = MAP_TYPES[newBasinSettings.mapType || 0].label;
        s.button('Map Type: '+maptype,true);
    },function(){
        yearselbox.enterFunc();
        if(newBasinSettings.mapType===undefined) newBasinSettings.mapType = 0;
        newBasinSettings.mapType++;
        newBasinSettings.mapType %= MAP_TYPES.length;
        advancedBasinSettings = {};
        Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);
    })

    let yearsel = maptypesel.append(false,0,basinCreationMenuButtonSpacing,0,basinCreationMenuButtonHeights,function(s){ // Year selector
        textAlign(LEFT,CENTER);
        text("Starting year: ",0,basinCreationMenuButtonHeights/2);
    });

    yearsel.append(false,110,0,basinCreationMenuButtonWidths-110,basinCreationMenuButtonHeights,function(s){
        let yName;
        if(newBasinSettings.year===undefined) yName = "Current year";
        else{
            let y = newBasinSettings.year;
            let h;
            if(advancedBasinSettings.hem===1) h = false;
            if(advancedBasinSettings.hem===2) h = true;
            if(h===undefined){
                yName = seasonName(y,false) + " or " + seasonName(y,true);
            }else yName = seasonName(y,h);
        }
        textAlign(LEFT,CENTER);
        let fontSize = 18;
        textSize(fontSize);
        while(textWidth(yName)>this.width-10 && fontSize>8){
            fontSize--;
            textSize(fontSize);
        }
        s.button(yName,true,fontSize);
    },function(){
        yearselbox.toggleShow();
        if(yearselbox.showing) yearselbox.clicked();
    });

    yearselbox = yearsel.append(false,110,0,basinCreationMenuButtonWidths-110,basinCreationMenuButtonHeights,[18,16,function(){
        if(yearselbox.showing){
            let v = yearselbox.value;
            let m = v.match(/^\s*(\d+)(\s+B\.?C\.?(?:E\.?)?)?(?:\s*-\s*(\d+))?(?:\s+(?:(B\.?C\.?(?:E\.?)?)|A\.?D\.?|C\.?E\.?))?\s*$/i);
            if(m){
                let bce = m[2] || m[4];
                let bce2 = m[4];
                let year1 = parseInt(m[1]);
                if(bce) year1 = 1-year1;
                let year2;
                if(m[3]){
                    year2 = parseInt(m[3]);
                    if(bce2) year2 = 1-year2;
                    if(year1+1===year2 || (year1+1)%100===year2) newBasinSettings.year = year1+1;
                    else newBasinSettings.year = undefined;
                }else newBasinSettings.year = year1;
            }else if(v!=='') newBasinSettings.year = undefined;
            if(newBasinSettings.year && !moment.utc([newBasinSettings.year,0,1]).isValid()) newBasinSettings.year = undefined;
            yearselbox.value = '';
            yearselbox.hide();
        }
    }],undefined,false);

    let gmodesel = yearsel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // Simulation mode selector
        let mode = newBasinSettings.actMode || 0;
        mode = SIMULATION_MODES[mode];
        s.button('Simulation Mode: '+mode,true);
    },function(){
        yearselbox.enterFunc();
        if(newBasinSettings.actMode===undefined) newBasinSettings.actMode = 0;
        newBasinSettings.actMode++;
        newBasinSettings.actMode %= SIMULATION_MODES.length;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // God mode Selector
        let gMode = newBasinSettings.godMode ? "Enabled" : "Disabled";
        s.button('God Mode: '+gMode,true);
    },function(){
        yearselbox.enterFunc();
        newBasinSettings.godMode = !newBasinSettings.godMode;
    });

    gmodesel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Advanced options button
        s.button("Advanced",true);
    },function(){
        yearselbox.enterFunc();
        basinCreationMenu.hide();
        basinCreationMenuAdvanced.show();
    });

    basinCreationMenu.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,7*HEIGHT/8-20,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // "Start" button
        s.button("Start",true,20);
    },function(){
        yearselbox.enterFunc();
        let seed = seedsel.value;
        if(/^-?\d+$/g.test(seed)) advancedBasinSettings.seed = parseInt(seed);
        else advancedBasinSettings.seed = hashCode(seed);
        seedsel.value = '';

        let opts = {};
        if(advancedBasinSettings.hem===1) opts.hem = false;
        else if(advancedBasinSettings.hem===2) opts.hem = true;
        else opts.hem = random()<0.5;
        opts.year = opts.hem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR;
        if(newBasinSettings.year!==undefined) opts.year = newBasinSettings.year;
        for(let o of [
            'actMode',
            'mapType',
            'godMode',
        ]) opts[o] = newBasinSettings[o];
        for(let o of [
            'seed',
            'designations',
            'scale',
            'scaleFlavor'
        ]) opts[o] = advancedBasinSettings[o];
        let basin = new Basin(false,opts);

        newBasinSettings = {};
        newBasinSettings.mapType = 6; // default to Atlantic
        advancedBasinSettings = {};
        Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);

        basin.initialized.then(()=>{
            basin.mount();
        });
        basinCreationMenu.hide();
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){ // "Cancel" button
        s.button("Cancel",true,20);
    },function(){
        yearselbox.value = '';
        yearselbox.hide();
        basinCreationMenu.hide();
        mainMenu.show();
    });

    // basin creation menu advanced options

    basinCreationMenuAdvanced.append(false,WIDTH/2,HEIGHT/16,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("New Basin Settings (Advanced)",0,0);
    });

    let hemsel = basinCreationMenuAdvanced.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,HEIGHT/8,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){   // hemisphere selector
        let hem = "Random";
        if(advancedBasinSettings.hem===1) hem = "Northern";
        if(advancedBasinSettings.hem===2) hem = "Southern";
        s.button('Hemisphere: '+hem,true);
    },function(){
        yearselbox.enterFunc();
        if(advancedBasinSettings.hem===undefined) advancedBasinSettings.hem = 1;
        else{
            advancedBasinSettings.hem++;
            advancedBasinSettings.hem %= 3;
        }
    });

    let desigsel = hemsel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // Scale selector
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale].displayName;
        s.button('Scale: '+scale,true);
    },function(){
        if(advancedBasinSettings.scale===undefined) advancedBasinSettings.scale = 0;
        advancedBasinSettings.scale++;
        advancedBasinSettings.scale %= Scale.presetScales.length;
        advancedBasinSettings.scaleFlavor = 0;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Scale flavor selector
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale];
        let flavor = advancedBasinSettings.scaleFlavor || 0;
        let grey = scale.flavorDisplayNames.length<2;
        s.button('Scale Flavor: '+(scale.flavorDisplayNames[flavor] || 'N/A'),true,18,grey);
    },function(){
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale];
        if(scale.flavorDisplayNames.length<2) return;
        if(advancedBasinSettings.scaleFlavor===undefined) advancedBasinSettings.scaleFlavor = 0;
        advancedBasinSettings.scaleFlavor++;
        advancedBasinSettings.scaleFlavor %= scale.flavorDisplayNames.length;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Designations selector
        let ds = advancedBasinSettings.designations || 0;
        ds = DesignationSystem.presetDesignationSystems[ds].displayName;
        s.button('Designations: '+ds,true);
    },function(){
        if(advancedBasinSettings.designations===undefined) advancedBasinSettings.designations = 0;
        advancedBasinSettings.designations++;
        advancedBasinSettings.designations %= DesignationSystem.presetDesignationSystems.length;
    });

    let seedsel = desigsel.append(false,0,basinCreationMenuButtonSpacing,0,basinCreationMenuButtonHeights,function(s){
        textAlign(LEFT,CENTER);
        text('Seed:',0,basinCreationMenuButtonHeights/2);
    }).append(false,50,0,basinCreationMenuButtonWidths-50,basinCreationMenuButtonHeights,[18,16]);

    basinCreationMenuAdvanced.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,7*HEIGHT/8-20,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){ // "Back" button
        s.button("Back", true, 20);
    },function(){
        basinCreationMenuAdvanced.hide();
        basinCreationMenu.show();
    });

    // load menu

    loadMenu.loadables = []; // cache that stores a list of saved basins and if they are loadable
    loadMenu.page = 0;

    loadMenu.append(false,WIDTH/2,HEIGHT/8,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Load Basin",0,0);
    });

    loadMenu.refresh = function(){
        loadMenu.loadables = [];
        waitForAsyncProcess(()=>{
            return db.transaction('r',db.saves,()=>{
                let col = db.saves.orderBy('format');
                let saveNames = col.primaryKeys();
                let formats = col.keys();
                return Promise.all([saveNames,formats]);
            }).then(res=>{
                let saveNames = res[0];
                let formats = res[1];
                for(let i=0;i<saveNames.length;i++){
                    loadMenu.loadables.push({
                        saveName: saveNames[i],
                        format: formats[i]
                    });
                }
                loadMenu.loadables.sort((a,b)=>{
                    a = a.saveName;
                    b = b.saveName;
                    if(a===AUTOSAVE_SAVE_NAME) return -1;
                    if(b===AUTOSAVE_SAVE_NAME) return 1;
                    return a>b ? 1 : -1;
                });
            });
        },'Fetching Saved Basins...').catch(e=>{
            console.error(e);
        });
    };

    let loadbuttonrender = function(s){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.buttonNum];
        let label;
        let loadable;
        if(!b){
            label = '--Empty--';
            loadable = false;
        }else{
            label = b.saveName;
            if(b.format < EARLIEST_COMPATIBLE_FORMAT || b.format > SAVE_FORMAT){
                label += " [Incompatible]";
                loadable = false;
            }else loadable = true;
        }
        let fontSize = 18;
        textSize(fontSize);
        while(textWidth(label)>this.width-10 && fontSize>8){
            fontSize--;
            textSize(fontSize);
        }
        s.button(label,true,fontSize,!loadable);
    };

    let loadbuttonclick = function(){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.buttonNum];
        if(b && b.format >= EARLIEST_COMPATIBLE_FORMAT && b.format <= SAVE_FORMAT){
            let basin = new Basin(b.saveName);
            basin.initialized.then(()=>{
                basin.mount();
            });
            loadMenu.hide();
        }
    };

    let loadbuttons = [];

    for(let i=0;i<LOAD_MENU_BUTTONS_PER_PAGE;i++){
        let x = i===0 ? WIDTH/2-150 : 0;
        let y = i===0 ? HEIGHT/4 : 40;
        loadbuttons[i] = loadMenu.append(1,x,y,300,30,loadbuttonrender,loadbuttonclick);
        loadbuttons[i].buttonNum = i;
    }

    loadMenu.append(1,0,40,300,30,function(s){ // "Cancel" button
        s.button("Cancel",true,20);
    },function(){
        loadMenu.hide();
        mainMenu.show();
    });

    loadMenu.append(false,WIDTH/2-75,HEIGHT/4-40,30,30,function(s){   // prev page
        s.button('',true,18,loadMenu.page<1);
        triangle(5,15,25,5,25,25);
    },function(){
        if(loadMenu.page>0) loadMenu.page--;
    }).append(false,120,0,30,30,function(s){    // next page
        let grey = loadMenu.page>=ceil(loadMenu.loadables.length/LOAD_MENU_BUTTONS_PER_PAGE)-1;
        s.button('',true,18,grey);
        triangle(5,5,25,15,5,25);
    },function(){
        if(loadMenu.page<ceil(loadMenu.loadables.length/LOAD_MENU_BUTTONS_PER_PAGE)-1) loadMenu.page++;
    });

    let delbuttonrender = function(s){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.parent.buttonNum];
        s.button("Del",true,18,!b);
    };

    let delbuttonclick = function(){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.parent.buttonNum];
        if(b){
            areYouSure.dialog(()=>{
                Basin.deleteSave(b.saveName,()=>{
                    loadMenu.refresh();
                });
            },'Delete "'+b.saveName+'"?');
        }
    };

    for(let i=0;i<LOAD_MENU_BUTTONS_PER_PAGE;i++) loadbuttons[i].append(false,315,0,40,30,delbuttonrender,delbuttonclick);

    // Settings Menu

    settingsMenu.append(false,WIDTH/2,HEIGHT/8,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Settings",0,0);
    });

    settingsMenu.append(false, WIDTH / 2 - 150, 3 * HEIGHT / 16, 300, 30, function(s){   // storm intensity indicator
        let b = simSettings.showStrength ? "Enabled" : "Disabled";
        s.button("Intensity Indicator: "+b,true);
    },function(){
        simSettings.setShowStrength("toggle");
    }).append(false,0,37,300,30,function(s){     // autosaving
        let b = simSettings.doAutosave ? "Enabled" : "Disabled";
        s.button("Autosaving: "+b,true);
    },function(){
        simSettings.setDoAutosave("toggle");
    }).append(false,0,37,300,30,function(s){     // track mode
        let m = ["Active TC Tracks","Full Active Tracks","Season Summary","No Tracks"][simSettings.trackMode];
        s.button("Track Mode: "+m,true);
    },function(){
        simSettings.setTrackMode("incmod",4);
        refreshTracks(true);
    }).append(false,0,37,300,30,function(s){     // snow
        let b = simSettings.snowLayers ? (simSettings.snowLayers*10) + " layers" : "Disabled";
        s.button("Snow: "+b,true);
    },function(){
        simSettings.setSnowLayers("incmod",floor(MAX_SNOW_LAYERS/10)+1);
        if(land) land.clearSnow();
    }).append(false,0,37,300,30,function(s){     // shadows (NOT a shader O~O)
        let b = simSettings.useShadows ? "Enabled" : "Disabled";
        s.button("Land Shadows: "+b,true);
    },function(){
        simSettings.setUseShadows("toggle");
    }).append(false,0,37,300,30,function(s){     // magnifying glass
        let b = simSettings.showMagGlass ? "Enabled" : "Disabled";
        s.button("Magnifying Glass: "+b,true);
    },function(){
        simSettings.setShowMagGlass("toggle");
        if(UI.viewBasin) UI.viewBasin.env.updateMagGlass();
    }).append(false,0,37,300,30,function(s){     // smooth land color
        let b = simSettings.smoothLandColor ? "Enabled" : "Disabled";
        s.button("Smooth Land Color: "+b,true);
    },function(){
        simSettings.setSmoothLandColor("toggle");
        if(land){
            // landBuffer.clear();
            land.drawn = false;
        }
    }).append(false,0,37,300,30,function(s){     // speed unit
        let u = ['kts', 'mph', 'km/h'][simSettings.speedUnit];
        s.button("Windspeed Unit: " + u, true);
    },function(){
        simSettings.setSpeedUnit("incmod", 3);
    }).append(false,0,37,300,30,function(s){     // color scheme
        let n = COLOR_SCHEMES[simSettings.colorScheme].name;
        s.button("Color Scheme: " + n, true);
    },function(){
        simSettings.setColorScheme("incmod", COLOR_SCHEMES.length);
        refreshTracks(true);
    });

    settingsMenu.append(false,WIDTH/2-150,7*HEIGHT/8-20,300,30,function(s){ // "Back" button
        s.button("Back",true,20);
    },function(){
        settingsMenu.hide();
        if(UI.viewBasin instanceof Basin) primaryWrapper.show();
        else mainMenu.show();
    });

    // Are you sure dialog

    areYouSure.append(false,WIDTH/2,HEIGHT/4,0,0,function(s){ // dialog text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Are You Sure?",0,0);
        if(areYouSure.desc){
            textSize(24);
            text(areYouSure.desc,0,50);
        }
    });

    areYouSure.append(false,WIDTH/2-108,HEIGHT/4+100,100,30,function(s){ // "Yes" button
        s.button("Yes",true,20);
    },function(){
        if(areYouSure.action){
            areYouSure.action();
            areYouSure.action = undefined;
        }
        else console.error("No action tied to areYouSure dialog");
        areYouSure.hide();
    }).append(false,116,0,100,30,function(s){ // "No" button
        s.button("No",true,20);
    },function(){
        areYouSure.hide();
    });

    areYouSure.dialog = function(action,desc){
        if(action instanceof Function){
            areYouSure.action = action;
            if(typeof desc === "string") areYouSure.desc = desc;
            else areYouSure.desc = undefined;
            areYouSure.show();
        }
    };

    // designation system editor

    const desig_editor_definition = (()=>{
        const section_spacing = 36;
        const section_heights = 28;
        const section_width = 400;
        const name_sections = 6;

        let editing_sub_basin;
        let desig_system;
        let name_list_num = 0;
        let name_list_page = 0;
        let list_lists_mode = true;
        let aux_list = false;
        let prefix_box;
        let suffix_box;
        let num_affix_section;
        let name_editor;
        let name_edit_box;
        let name_edit_index = 0;
        let adding_name = false;

        const refresh_num_section = ()=>{
            if(desig_system instanceof DesignationSystem){
                prefix_box.value = desig_system.numbering.prefix || '';
                suffix_box.value = desig_system.numbering.suffix || '';
            }
            if(desig_system && desig_system.numbering.enabled)
                num_affix_section.show();
            else
                num_affix_section.hide();
        };
        const refresh_name_section = ()=>{
            name_list_page = 0;
        };
        const refresh_desig_editor = ()=>{
            if(editing_sub_basin === undefined)
                editing_sub_basin = UI.viewBasin.mainSubBasin;
            let sb = UI.viewBasin.subBasins[editing_sub_basin];
            if(sb && sb.designationSystem)
                desig_system = sb.designationSystem;
            name_list_num = 0;
            list_lists_mode = true;
            aux_list = false;
            refresh_num_section();
            refresh_name_section();
        };

        const list_array = ()=>{
            if(desig_system instanceof DesignationSystem){
                if(aux_list)
                    return desig_system.naming.auxiliaryLists;
                else
                    return desig_system.naming.mainLists;
            }
        };
        const get_list_from_index = (i)=>{
            let list_arr = list_array();
            if(list_arr)
                return list_arr[i];
        };
        const get_list = ()=>{
            return get_list_from_index(name_list_num);
        };
        const name_at = (i)=>{
            let txt;
            let list = get_list();
            if(list && list[i])
                txt = list[i];
            return txt;
        };
        const invoke_name_editor = (i,is_new_name)=>{
            let list = get_list();
            if(list){
                name_edit_index = i;
                if(is_new_name)
                    name_edit_box.value = '';
                else
                    name_edit_box.value = list[i];
                adding_name = is_new_name;
                name_editor.show();
                name_edit_box.clicked();
            }
        };

        // title text
        desigSystemEditor.append(false,WIDTH/2,HEIGHT/16,0,0,s=>{
            fill(COLORS.UI.text);
            noStroke();
            textAlign(CENTER,CENTER);
            textSize(36);
            text("Designations Editor",0,0);
        });

        // sub-basin selector
        let sb_selector = desigSystemEditor.append(false,WIDTH/2-section_width/2,HEIGHT/8,section_width,0,s=>{
            let txt = 'Editing sub-basin: ';
            let sb = UI.viewBasin.subBasins[editing_sub_basin];
            if(sb instanceof SubBasin)
                txt += sb.getDisplayName();
            textAlign(CENTER,CENTER);
            textSize(18);
            text(txt,section_width/2,section_heights/2);
        });
        
        sb_selector.append(false,0,0,30,10,s=>{ // next sub-basin button
            s.button('',true);
            triangle(15,2,23,8,7,8);
        },()=>{
            do{
                editing_sub_basin++;
                if(editing_sub_basin > 255)
                    editing_sub_basin = 0;
            }while(!(UI.viewBasin.subBasins[editing_sub_basin] instanceof SubBasin && UI.viewBasin.subBasins[editing_sub_basin].designationSystem));
            refresh_desig_editor();
        }).append(false,0,18,30,10,s=>{ // prev sub-basin button
            s.button('',true);
            triangle(15,8,23,2,7,2);
        },()=>{
            do{
                editing_sub_basin--;
                if(editing_sub_basin < 0)
                    editing_sub_basin = 255;
            }while(!(UI.viewBasin.subBasins[editing_sub_basin] instanceof SubBasin && UI.viewBasin.subBasins[editing_sub_basin].designationSystem));
            refresh_desig_editor();
        });

        // numbering enabled/disabled button
        let num_button = sb_selector.append(false,0,section_spacing,section_width,section_heights,s=>{
            let txt = 'Numbering: ';
            let grey = false;
            if(desig_system instanceof DesignationSystem){
                if(desig_system.numbering.enabled)
                    txt += 'Enabled';
                else
                    txt += 'Disabled';
            }
            else{
                txt += 'N/A';
                grey = true;
            }
            s.button(txt,true,18,grey);
        },()=>{
            if(desig_system instanceof DesignationSystem){
                desig_system.numbering.enabled = !desig_system.numbering.enabled;
                refresh_num_section();
            }
        });

        num_affix_section = num_button.append(false,0,section_spacing,0,0);

        // numbering prefix box
        prefix_box = num_affix_section.append(false,0,0,0,0,s=>{
            textAlign(LEFT,CENTER);
            text('Prefix:',0,section_heights/2);
        }).append(false,70,0,section_width/2-75,section_heights,[18,6,()=>{
            if(desig_system instanceof DesignationSystem && desig_system.numbering.enabled)
                desig_system.numbering.prefix = prefix_box.value;
        }]);

        // numbering suffix box
        suffix_box = num_affix_section.append(false,section_width/2+5,0,0,0,s=>{
            textAlign(LEFT,CENTER);
            text('Suffix:',0,section_heights/2);
        }).append(false,70,0,section_width/2-75,section_heights,[18,6,()=>{
            if(desig_system instanceof DesignationSystem && desig_system.numbering.enabled)
                desig_system.numbering.suffix = suffix_box.value;
        }]);

        // name list selector
        let list_selector = num_button.append(false,0,section_spacing*2,section_width,section_heights,s=>{
            let txt;
            if(list_lists_mode)
                txt = aux_list ? `Auxiliary Name Lists` : `Main Name Lists`;
            else
                txt = `Editing name list:${aux_list ? ' Aux.' : ''} List ${name_list_num + 1}`;
            s.button(txt,true,18);
        },()=>{
            if(desig_system instanceof DesignationSystem){
                if(list_lists_mode)
                    aux_list = !aux_list;
                else
                    list_lists_mode = true;
                refresh_name_section();
            }
        });

        const add_name_edit_section = (prev,i)=>{
            const my_width = section_width - 80;
            const index = ()=>name_list_page * name_sections + i;

            let section = prev.append(false,0,section_spacing,my_width,section_heights,s=>{
                let txt = '--';
                let grey = true;
                if(list_lists_mode){
                    let list = get_list_from_index(index());
                    if(list){
                        txt = `${aux_list ? ' Aux.' : ''} List ${index() + 1}`;
                        grey = false;
                    }
                }else{
                    let name = name_at(index());
                    if(name){
                        txt = name;
                        grey = false;
                    }
                }
                s.button(txt,true,18,grey);
            },()=>{
                if(list_lists_mode){
                    let list = get_list_from_index(index());
                    if(list){
                        name_list_num = index();
                        list_lists_mode = false;
                        refresh_name_section();
                    }
                }else{
                    let name = name_at(index());
                    if(name)
                        invoke_name_editor(index(),false);
                }
            });

            section.append(false,my_width+10,0,30,12,s=>{
                let grey = true;
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && index() <= list_arr.length)
                        grey = false;
                }else{
                    let list = get_list();
                    if(list && index() <= list.length)
                        grey = false;
                }
                s.button('+',true,15,grey);
                triangle(25,3,28,10,22,10);
            },()=>{
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && index() <= list_arr.length){
                        list_arr.splice(index(), 0, []);
                        name_list_num = index();
                        list_lists_mode = false;
                    }
                }else{
                    let list = get_list();
                    if(list && index() <= list.length)
                        invoke_name_editor(index(), true);
                }
            }).append(false,0,section_heights-12,30,12,s=>{
                let grey = true;
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && (index() + 1) <= list_arr.length)
                        grey = false;
                }else{
                    let list = get_list();
                    if(list && (index() + 1) <= list.length)
                        grey = false;
                }
                s.button('+',true,15,grey);
                triangle(25,9,28,2,22,2);
            },()=>{
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && (index() + 1) <= list_arr.length){
                        list_arr.splice(index() + 1, 0, []);
                        name_list_num = index() + 1;
                        list_lists_mode = false;
                    }
                }else{
                    let list = get_list();
                    if(list && (index() + 1) <= list.length)
                        invoke_name_editor(index() + 1, true);
                }
            });

            section.append(false,my_width+50,0,30,section_heights,s=>{
                let grey;
                if(list_lists_mode)
                    grey = !get_list_from_index(index());
                else
                    grey = !name_at(index());
                s.button('X',true,21,grey);
            },()=>{
                if(list_lists_mode){
                    if(get_list_from_index(index())){
                        let list_arr = list_array();
                        areYouSure.dialog(()=>{
                            list_arr.splice(index(), 1);
                            if(list_arr.length <= name_list_page * name_sections && list_arr.length > 0)
                                name_list_page--;
                        }, `Delete ${aux_list ? 'Aux. ' : ''} List ${index() + 1}?`);
                    }
                }else if(name_at(index())){
                    let list = get_list();
                    list.splice(index(), 1);
                    if(list.length <= name_list_page * name_sections && list.length > 0)
                        name_list_page--;
                }
            });
            return section;
        };

        for(let i = 0, prev = list_selector; i < name_sections; i++){
            prev = add_name_edit_section(prev,i);
        }

        let list_nav = list_selector.append(false,0,section_spacing * (name_sections + 1),0,0);

        list_nav.append(false,section_width/2-40,0,30,section_heights,s=>{
            let grey = true;
            if(name_list_page > 0)
                grey = false;
            s.button('',true,18,grey);
            triangle(4,14,26,4,26,24);
        },()=>{
            if(name_list_page > 0)
                name_list_page--;
        }).append(false,50,0,30,section_heights,s=>{
            let grey = true;
            let list = list_lists_mode ? list_array() : get_list();
            if(list && (name_list_page + 1) * name_sections < list.length)
                grey = false;
            s.button('',true,18,grey);
            triangle(26,14,4,4,4,24);
        },()=>{
            let list = list_lists_mode ? list_array() : get_list();
            if(list && (name_list_page + 1) * name_sections < list.length)
                name_list_page++;
        });

        desigSystemEditor.append(false,WIDTH/2-section_width/2,7*HEIGHT/8+10,section_width,section_heights,function(s){ // "Done" button
            s.button("Done",true,20);
        },function(){
            prefix_box.enterFunc();
            suffix_box.enterFunc();
            editing_sub_basin = UI.viewBasin.mainSubBasin;
            list_lists_mode = true;
            aux_list = false;
            name_list_num = 0;
            name_list_page = 0;
            desigSystemEditor.hide();
            if(UI.viewBasin instanceof Basin)
                primaryWrapper.show();
            else
                mainMenu.show();
        });

        name_editor = desigSystemEditor.append(false,0,0,WIDTH,HEIGHT,s=>{
            fill(COLORS.UI.box);
            noStroke();
            s.fullRect();
        },true,false);

        name_editor.append(false,WIDTH/2,HEIGHT/4,0,0,s=>{
            fill(COLORS.UI.text);
            noStroke();
            textAlign(CENTER,CENTER);
            textSize(24);
            text("Add/Edit Name",0,0);
        });

        name_edit_box = name_editor.append(false, WIDTH/2-section_width/2, HEIGHT/3, section_width, section_heights, [20, 15, ()=>{
            let list = get_list();
            if(list && name_edit_box.value){
                if(adding_name)
                    list.splice(name_edit_index,0,name_edit_box.value);
                else
                    list[name_edit_index] = name_edit_box.value;
            }
            name_editor.hide();
        }]);

        name_edit_box.append(false, 0, section_spacing, section_width, section_heights, s=>{
            s.button('Done',true,20);
        },()=>{
            name_edit_box.enterFunc();
        }).append(false, 0, section_spacing, section_width, section_heights, s=>{
            s.button('Cancel',true,20);
        },()=>{
            name_editor.hide();
        });

        return {refresh: refresh_desig_editor};
    })();

    // primary "in sim" scene

    let topBar = primaryWrapper.append(false,0,0,WIDTH,30,function(s){   // Top bar
        fill(COLORS.UI.bar);
        noStroke();
        s.fullRect();
        textSize(18);
    },false);

    topBar.append(false,5,3,100,24,function(s){  // Date indicator
        if(!(UI.viewBasin instanceof Basin)) return;
        let basin = UI.viewBasin;
        let txtStr = formatDate(basin.tickMoment(viewTick)) + (basin.viewingPresent() ? '' : ' [Analysis]');
        this.setBox(undefined,undefined,textWidth(txtStr)+6);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        text(txtStr,3,3);
    },function(){
        dateNavigator.toggleShow();
    });

    let panel_timeline_container = primaryWrapper.append(false,0,topBar.height,0,0,undefined,undefined,false);

    dateNavigator = primaryWrapper.append(false,0,30,140,80,function(s){     // Analysis navigator panel
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        textSize(15);
        text('Y:',15,53);
    },true,false);

    let navButtonRend = function(s){     // Navigator button render function
        s.button('',false,18,!paused);
        if(this.metadata%2===0) triangle(2,8,10,2,18,8);
        else triangle(2,2,18,2,10,8);
    };

    let navButtonClick = function(){    // Navigator button click function
        if(UI.viewBasin instanceof Basin && paused){
            let basin = UI.viewBasin;
            let m = basin.tickMoment(viewTick);
            switch(this.metadata){
                case 0:
                m.add(TICK_DURATION*ADVISORY_TICKS,"ms");
                break;
                case 1:
                m.subtract(TICK_DURATION*ADVISORY_TICKS,"ms");
                break;
                case 2:
                m.add(1,"M");
                break;
                case 3:
                m.subtract(1,"M");
                break;
                case 4:
                m.add(1,"d");
                break;
                case 5:
                m.subtract(1,"d");
                break;
                case 6:
                m.add(1,"y");
                break;
                case 7:
                m.subtract(1,"y");
                break;
            }
            let t = basin.tickFromMoment(m);
            if(this.metadata%2===0 && t%ADVISORY_TICKS!==0) t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(this.metadata%2!==0 && t%ADVISORY_TICKS!==0) t = ceil(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(t>basin.tick) t = basin.tick;
            if(t<0) t = 0;
            changeViewTick(t);
        }
    };

    for(let i=0;i<8;i++){   // Navigator buttons
        let x = floor(i/2)*30+15;
        let y = i%2===0 ? 10 : 30;
        let button = dateNavigator.append(false,x,y,20,10,navButtonRend,navButtonClick);
        button.metadata = i;
    }

    let dateNavYearInput = dateNavigator.append(false,30,50,70,20,[15,5,function(){
        if(!(UI.viewBasin instanceof Basin)) return;
        let basin = UI.viewBasin;
        let v = this.value;
        let n = parseInt(v);
        if(!Number.isNaN(n) && paused){
            let m = basin.tickMoment(viewTick);
            m.year(n);
            let t = basin.tickFromMoment(m);
            if(t%ADVISORY_TICKS!==0) t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(t>basin.tick) t = basin.tick;
            if(t<0) t = 0;
            changeViewTick(t);
            this.value = '';
        }
    }]);

    dateNavYearInput.append(false,80,0,20,20,function(s){
        let v = UI.focusedInput === dateNavYearInput ? /* textInput */UI.inputData.value : dateNavYearInput.value;
        let grey;
        if(Number.isNaN(parseInt(v))) grey = true;
        s.button('',false,15,grey);
        triangle(6,3,17,10,6,17);
        rect(2,8,4,4);
    },function(){
        dateNavYearInput.enterFunc();
    });

    topBar.append(false,WIDTH-29,3,24,24,function(s){    // Toggle button for storm info panel and timeline
        s.button('');
        if(panel_timeline_container.showing) triangle(6,15,18,15,12,9);
        else triangle(6,9,18,9,12,15);
    },function(){
        if(!panel_timeline_container.showing) stormInfoPanel.target = selectedStorm || UI.viewBasin.getSeason(viewTick);
        panel_timeline_container.toggleShow();
    }).append(false,-29,0,24,10,function(s){     // Speed increase
        let grey = simSpeed == MAX_SPEED;
        s.button('', false, undefined, grey);
        triangle(4,2,12,5,4,8);
        triangle(12,2,20,5,12,8);
    },function(){
        if(simSpeed < MAX_SPEED)
            simSpeed++;
    }).append(false,0,14,24,10,function(s){     // Speed decrease
        let grey = simSpeed == MIN_SPEED;
        s.button('', false, undefined, grey);
        triangle(20,2,12,5,20,8);
        triangle(12,2,4,5,12,8);
    },function(){
        if(simSpeed > MIN_SPEED)
            simSpeed--;
    }).append(false,-29,-14,24,24,function(s){  // Pause/resume button
        s.button('');
        if(paused) triangle(3,3,21,12,3,21);
        else{
            rect(5,3,5,18);
            rect(14,3,5,18);
        }
    },function(){
        paused = !paused;
        lastUpdateTimestamp = performance.now();
    }).append(false,-105,0,100,24,function(s){  // Pause/speed/selected storm indicator
        let txtStr = "";
        if(selectedStorm){
            let sName = selectedStorm.getFullNameByTick(viewTick);
            let sData = selectedStorm.getStormDataByTick(viewTick);
            if(sData){
                let sWind = sData ? sData.windSpeed : 0;
                sWind = displayWindspeed(sWind);
                let sPrsr = sData ? sData.pressure: 1031;
                txtStr = `${sName}: ${sWind} / ${sPrsr} hPa`;
            }else{
                sName = selectedStorm.getFullNameByTick("peak");
                txtStr = sName + " - ACE: " + selectedStorm.ACE;
            }
        }else{
            if(paused)
                txtStr = "Paused";
            else if(simSpeed < -1)
                txtStr = `1/${Math.pow(2, -simSpeed)} Speed`;
            else if(simSpeed === -1)
                txtStr = 'Half-Speed';
            else if(simSpeed === 0)
                txtStr = 'Normal-Speed';
            else if(simSpeed === 1)
                txtStr = 'Double-Speed';
            else
                txtStr = `${Math.pow(2, simSpeed)}x Speed`;
        }
        let newW = textWidth(txtStr)+6;
        this.setBox(-newW-5,undefined,newW);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        fill(COLORS.UI.text);
        textAlign(RIGHT,TOP);
        text(txtStr,this.width-3,3);
    },function(){
        if(!selectedStorm){
            paused = !paused;
            lastUpdateTimestamp = performance.now();
        }else{
            stormInfoPanel.target = selectedStorm;
            panel_timeline_container.show();
        }
    });

    let bottomBar = primaryWrapper.append(false,0,HEIGHT-30,WIDTH,30,function(s){    // Bottom bar
        fill(COLORS.UI.bar);
        noStroke();
        s.fullRect();
        textSize(18);
    },false);

    bottomBar.append(false,5,3,24,24,function(s){    // Side menu button
        s.button('');
        rect(3,6,18,2);
        rect(3,11,18,2);
        rect(3,16,18,2);
    },function(){
        sideMenu.toggleShow();
        saveBasinAsPanel.hide();
    }).append(false,29,0,100,24,function(s){   // Map layer/environmental field indicator
        let basin = UI.viewBasin;
        let txtStr = "Map Layer: ";
        let red = false;
        if(basin.env.displaying!==-1){
            let f = basin.env.fieldList[basin.env.displaying];
            txtStr += basin.env.getDisplayName(f) + " -- ";
            let x;
            let y;
            let S = selectedStorm && selectedStorm.aliveAt(viewTick);
            if(S){
                let p = selectedStorm.getStormDataByTick(viewTick,true).pos;
                x = p.x;
                y = p.y;
            }else{
                x = getMouseX();
                y = getMouseY();
            }
            if(x >= WIDTH || x < 0 || y >= HEIGHT || y < 0 || (basin.env.fields[f].oceanic && land.get(Coordinate.convertFromXY(basin.mapType, x, y)))){
                txtStr += "N/A";
            }else{
                let v = basin.env.get(f,x,y,viewTick);
                if(v===null){
                    txtStr += "Unavailable";
                    red = true;
                }else
                    txtStr += basin.env.formatFieldValue(f,v);
            }
            txtStr += " @ " + (S ? "selected storm" : "pointer");
            if(viewTick<=basin.env.fields[f].accurateAfter){
                txtStr += ' [MAY BE INACCURATE]';
                red = true;
            }
        }else txtStr += "none";
        this.setBox(undefined,undefined,textWidth(txtStr)+6);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        if(red) fill('red');
        else fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        text(txtStr,3,3);
    },function(){
        UI.viewBasin.env.displayNext();
    });

    bottomBar.append(false,WIDTH-29,3,24,24,function(s){    // Fullscreen button
        s.button('',false);
        stroke(0);
        if(document.fullscreenElement===canvas){
            line(9,4,9,9);
            line(4,9,9,9);
            line(15,4,15,9);
            line(20,9,15,9);
            line(9,20,9,15);
            line(4,15,9,15);
            line(15,20,15,15);
            line(20,15,15,15);
        }else{
            line(4,4,4,9);
            line(4,4,9,4);
            line(20,4,20,9);
            line(20,4,15,4);
            line(4,20,4,15);
            line(4,20,9,20);
            line(20,20,20,15);
            line(20,20,15,20);
        }
    },function(){
        toggleFullscreen();
    }).append(false,-29,0,24,24,function(s){  // Help button
        noStroke();
        s.button("?",false,22);
    },function(){
        helpBox.toggleShow();
    });

    let timeline;
    let season_button;

    const INFO_PANEL_LEFT_BOUND = 11*WIDTH/16;

    stormInfoPanel = panel_timeline_container.append(false, INFO_PANEL_LEFT_BOUND, 0, WIDTH-INFO_PANEL_LEFT_BOUND, HEIGHT-topBar.height-bottomBar.height, function(s){
        let S = this.target;
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        const txt_width = 7*this.width/8;
        const left_col_width = 7*txt_width/16;
        const right_col_width = 9*txt_width/16;
        let name;
        let txt_y = 35;
        let info_row = (left, right)=>{
            left = wrapText('' + left, left_col_width);
            right = wrapText('' + right, right_col_width);
            textAlign(LEFT, TOP);
            text(left, this.width/16, txt_y);
            textAlign(RIGHT, TOP);
            text(right, 15*this.width/16, txt_y);
            txt_y += max(countTextLines(left) * textLeading(), countTextLines(right) * textLeading()) + 3;
        };
        if(S instanceof Storm){
            season_button.show();
            name = S.getFullNameByTick("peak");
            name = wrapText(name, txt_width);
            text(name, this.width/2, txt_y);
            txt_y += countTextLines(name)*textLeading();
            textSize(15);
            let right_txt = '';
            if(S.inBasinTC){
                let enterTime = formatDate(UI.viewBasin.tickMoment(S.enterTime));
                let exitTime = formatDate(UI.viewBasin.tickMoment(S.exitTime));
                right_txt += enterTime;
                if(S.enterTime > S.formationTime)
                    right_txt += ' (entered basin)';
                right_txt += ' -\n';
                if(S.exitTime){
                    right_txt += exitTime;
                    if(!S.dissipationTime || S.exitTime < S.dissipationTime)
                        right_txt += ' (left basin)';
                }else
                    right_txt += 'currently active';
            }else if(S.TC){
                let formTime = formatDate(UI.viewBasin.tickMoment(S.formationTime));
                let dissTime = formatDate(UI.viewBasin.tickMoment(S.dissipationTime));
                right_txt += formTime + ' -\n';
                if(S.dissipationTime)
                    right_txt += dissTime;
                else
                    right_txt += 'currently active';
            }else
                right_txt += "N/A";
            info_row('Dates active', right_txt);
            if(S.peak)
                info_row('Peak pressure', S.peak.pressure + ' hPa');
            else
                info_row('Peak pressure', 'N/A');
            if(S.windPeak)
                info_row('Peak wind speed', displayWindspeed(S.windPeak.windSpeed));
            else
                info_row('Peak wind speed', 'N/A');
            info_row('ACE', S.ACE);
            info_row('Damage', damageDisplayNumber(S.damage));
            info_row('Deaths', S.deaths);
            info_row('Landfalls', S.landfalls);
        }else{
            name = seasonName(S);
            name = wrapText(name, txt_width);
            text(name, this.width/2, txt_y);
            txt_y += countTextLines(name)*textLeading();
            textSize(15);
            let se = UI.viewBasin.fetchSeason(S);
            if(se instanceof Season){
                let stats = se.stats(UI.viewBasin.mainSubBasin);
                let counters = stats.classificationCounters;
                let scale = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin);
                for(let {statName, cNumber} of scale.statDisplay())
                    info_row(statName, counters[cNumber]);
                info_row('Total ACE', stats.ACE);
                info_row('Damage', damageDisplayNumber(stats.damage));
                info_row('Deaths', stats.deaths);
                info_row('Landfalls', stats.landfalls);
                if(stats.most_intense){
                    let most_intense = stats.most_intense.fetch();
                    info_row('Most Intense', most_intense.getNameByTick(-1) + '\n' + most_intense.peak.pressure + ' hPa\n' + displayWindspeed(most_intense.windPeak.windSpeed));
                }else
                    info_row('Most Intense', 'N/A');
            }else
                text('Season Data Unavailable', this.width/2, txt_y);
        }
    },true);

    let timeline_container = panel_timeline_container.append(false,0,0,0,0);

    function find_next_storm(storm,prev){
        if(storm instanceof Storm){
            let season = storm.basin.fetchSeason(storm.statisticalSeason());
            if(season instanceof Season){
                let recent;
                let found_me;
                for(let s of season.forSystems()){
                    if(s instanceof Storm){
                        if(s === storm){
                            if(prev)
                                return recent;
                            else
                                found_me = true;
                        }else if(s.inBasinTC){
                            if(prev)
                                recent = s;
                            else if(found_me)
                                return s;
                        }
                    }
                }
            }
        }
    }

    panel_timeline_container.append(false,INFO_PANEL_LEFT_BOUND+3,3,24,24,function(s){   // info panel/timeline previous storm/season button
        if(timeline.active())
            this.setBox(WIDTH*0.05,5,24,24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+3,3,24,24);
        let S = stormInfoPanel.target;
        let grey;
        if(S instanceof Storm)
            grey = !find_next_storm(S,true);
        else
            grey = S<=UI.viewBasin.getSeason(0);
        s.button('',false,18,grey);
        triangle(19,5,19,19,5,12);
    },function(){
        let s = stormInfoPanel.target;
        if(s instanceof Storm){
            let n = find_next_storm(s,true);
            if(n)
                stormInfoPanel.target = n;
        }else if(s>UI.viewBasin.getSeason(0))
            stormInfoPanel.target--;
    });
    
    panel_timeline_container.append(false,WIDTH-27,3,24,24,function(s){ // info panel/timeline next storm/season button
        if(timeline.active())
            this.setBox(WIDTH*0.95-24,5,24,24);
        else
            this.setBox(WIDTH-27,3,24,24);
        let S = stormInfoPanel.target;
        let grey;
        if(S instanceof Storm)
            grey = !find_next_storm(S);
        else
            grey = S>=UI.viewBasin.getSeason(-1);
        s.button('',false,18,grey);
        triangle(5,5,5,19,19,12);
    },function(){
        let s = stormInfoPanel.target;
        if(s instanceof Storm){
            let n = find_next_storm(s);
            if(n)
                stormInfoPanel.target = n;
        }else if(s<UI.viewBasin.getSeason(-1))
            stormInfoPanel.target++;
    });

    season_button = panel_timeline_container.append(false, INFO_PANEL_LEFT_BOUND+30, 3, stormInfoPanel.width-60, 24, function(s){ // Season button
        if(timeline.active())
            this.setBox(5*WIDTH/12, 32, WIDTH/6, 24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+30, 3, stormInfoPanel.width-60, 24);
        let t = stormInfoPanel.target;
        if(t instanceof Storm)
            s.button(seasonName(t.statisticalSeason()),false,15);
        else
            this.hide();
    },function(){
        let t = stormInfoPanel.target;
        if(t instanceof Storm)
            stormInfoPanel.target = t.statisticalSeason();
    });
    
    panel_timeline_container.append(false,INFO_PANEL_LEFT_BOUND+30,stormInfoPanel.height-54,stormInfoPanel.width-60,24,function(s){ // info panel "Jump to" button
        if(timeline.active())
            this.setBox(WIDTH*0.95 - WIDTH/6, 32, WIDTH/6, 24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+30,stormInfoPanel.height-54,stormInfoPanel.width-60,24);
        s.button("Jump to",false,15,!paused || stormInfoPanel.target===undefined);
    },function(){
        if(paused && stormInfoPanel.target!==undefined){
            let s = stormInfoPanel.target;
            let t;
            if(s instanceof Storm){
                if(s.enterTime) t = s.enterTime;
                else if(s.formationTime) t = s.formationTime;
                else t = s.birthTime;
                t = ceil(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            }else{
                t = UI.viewBasin.seasonTick(s);
            }
            changeViewTick(t);
        }
    });
    
    stormInfoPanel.append(false,30,stormInfoPanel.height-27,stormInfoPanel.width-60,24,function(s){ // show season summary timeline button
        s.button("View Timeline",false,15);
    },function(){
        timeline.view();
    });

    timeline = (function(){
        const BOX_WIDTH = WIDTH;
        const BOX_HEIGHT = (HEIGHT-topBar.height-bottomBar.height)*2/3;
        let months = 12;
        let sMonth = 0;
        let parts = [];
        let builtAt;
        let builtFor;
        let active = false;

        function build(){
            parts = [];
            let plotWidth = BOX_WIDTH*0.9;
            let target = stormInfoPanel.target;
            if(target!==undefined && !(target instanceof Storm)){
                let gen = s=>{
                    let TCs = [];
                    let beginSeasonTick;
                    let endSeasonTick;
                    for(let sys of s.forSystems()){
                        if(sys.inBasinTC && (UI.viewBasin.getSeason(sys.enterTime)===target || UI.viewBasin.getSeason(sys.enterTime)<target && (sys.exitTime===undefined || UI.viewBasin.getSeason(sys.exitTime-1)>=target))){
                            TCs.push(sys);
                            let dissTime = sys.exitTime || UI.viewBasin.tick;
                            if(beginSeasonTick===undefined || sys.enterTime<beginSeasonTick) beginSeasonTick = sys.enterTime;
                            if(endSeasonTick===undefined || dissTime>endSeasonTick) endSeasonTick = dissTime;
                        }
                    }
                    for(let n=0;n<TCs.length-1;n++){
                        let t0 = TCs[n];
                        let t1 = TCs[n+1];
                        if(t0.enterTime>t1.enterTime){
                            TCs[n] = t1;
                            TCs[n+1] = t0;
                            if(n>0) n -= 2;
                        }
                    }
                    let sMoment = UI.viewBasin.tickMoment(beginSeasonTick);
                    sMonth = sMoment.month();
                    sMoment.startOf('month');
                    let beginPlotTick = UI.viewBasin.tickFromMoment(sMoment);
                    let eMoment = UI.viewBasin.tickMoment(endSeasonTick);
                    eMoment.endOf('month');
                    let endPlotTick = UI.viewBasin.tickFromMoment(eMoment);
                    months = eMoment.diff(sMoment,'months') + 1;
                    for(let t of TCs){
                        let part = {};
                        part.storm = t;
                        part.segments = [];
                        part.label = t.getNameByTick(-2);
                        let aSegment;
                        for(let q=0;q<t.record.length;q++){
                            let rt = ceil(t.birthTime/ADVISORY_TICKS)*ADVISORY_TICKS + q*ADVISORY_TICKS;
                            let d = t.record[q];
                            if(tropOrSub(d.type)&&land.inBasin(d.coord())){
                                let clsn = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin).get(d);
                                if(!aSegment){
                                    aSegment = {};
                                    part.segments.push(aSegment);
                                    aSegment.startTick = rt;
                                    aSegment.maxCat = clsn;
                                    aSegment.fullyTrop = (d.type===TROP);
                                }
                                if(clsn > aSegment.maxCat) aSegment.maxCat = clsn;
                                aSegment.fullyTrop = aSegment.fullyTrop || (d.type===TROP);
                                aSegment.endTick = rt;
                            }else if(aSegment) aSegment = undefined;
                        }
                        for(let q=0;q<part.segments.length;q++){
                            let seg = part.segments[q];
                            seg.startX = map(seg.startTick,beginPlotTick,endPlotTick,0,plotWidth);
                            seg.endX = map(seg.endTick,beginPlotTick,endPlotTick,0,plotWidth);
                        }
                        let rowFits;
                        part.row = -1;
                        textSize(12);
                        let thisLabelZone = textWidth(part.label) + 6;
                        do{
                            part.row++;
                            rowFits = true;
                            for(let q=0;q<parts.length;q++){
                                let p = parts[q];
                                let otherLabelZone = textWidth(p.label) + 6;
                                let thisS = part.segments[0].startX;
                                let thisE = part.segments[part.segments.length-1].endX + thisLabelZone;
                                let otherS = p.segments[0].startX;
                                let otherE = p.segments[p.segments.length-1].endX + otherLabelZone;
                                if(p.row===part.row){
                                    if(thisS>=otherS && thisS<=otherE ||
                                        thisE>=otherS && thisE<=otherE ||
                                        otherS>=thisS && otherS<=thisE ||
                                        otherE>=thisS && otherE<=thisE) rowFits = false;
                                }
                            }
                        }while(!rowFits);
                        parts.push(part);
                    }
                };
                if(UI.viewBasin.fetchSeason(target)) gen(UI.viewBasin.fetchSeason(target));
                else{
                    months = 12;
                    sMonth = 0;
                    UI.viewBasin.fetchSeason(target,false,false,s=>{
                        gen(s);
                    });
                }
            }else{
                months = 12;
                sMonth = 0;
            }
            builtFor = target;
            builtAt = UI.viewBasin.tick;
        }

        const lBound = BOX_WIDTH*0.05;
        const rBound = BOX_WIDTH*0.95;
        const tBound = BOX_HEIGHT*0.2;
        const bBound = BOX_HEIGHT*0.93;
        const maxRowFit = Math.floor((bBound-tBound)/15);

        let timelineBox = timeline_container.append(false,0,0,BOX_WIDTH,BOX_HEIGHT,function(s){
            let target = stormInfoPanel.target;
            if(target!==builtFor || (UI.viewBasin.tick!==builtAt && (UI.viewBasin.getSeason(builtAt)===target || UI.viewBasin.getSeason(builtAt)===(target+1)))) build();
            fill(COLORS.UI.box);
            noStroke();
            s.fullRect();
            fill(COLORS.UI.text);
            textAlign(CENTER,TOP);
            textSize(18);
            if(target === undefined)
                text('No timeline selected', BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
            else if(target instanceof Storm){
                text('Intensity graph of ' + target.getFullNameByTick('peak'), BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
                season_button.show();
                let begin_tick = target.enterTime;
                let end_tick = target.exitTime || UI.viewBasin.tick;
                let max_wind;
                for(let t = begin_tick; t <= end_tick; t += ADVISORY_TICKS){
                    if(target.getStormDataByTick(t)){
                        let w = target.getStormDataByTick(t).windSpeed;
                        if(max_wind === undefined || w > max_wind)
                            max_wind = w;
                    }
                }
                let scale = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin);
                if(scale.measure === SCALE_MEASURE_ONE_MIN_KNOTS || scale.measure === SCALE_MEASURE_TEN_MIN_KNOTS){
                    let color = scale.getColor(0);
                    let y0 = bBound;
                    for(let i = 1; i < scale.classifications.length; i++){
                        let threshold = scale.classifications[i].threshold;
                        let y1 = map(threshold, 0, max_wind, bBound, tBound, true);
                        fill(red(color), green(color), blue(color), 90);
                        rect(lBound, y1, rBound - lBound, y0 - y1);
                        color = scale.getColor(i);
                        y0 = y1;
                        if(threshold > max_wind)
                            break;
                        if(i === scale.classifications.length - 1 && threshold < max_wind){
                            fill(red(color), green(color), blue(color), 90);
                            rect(lBound, tBound, rBound - lBound, y0 - tBound);
                        }
                    }
                }
                stroke(COLORS.UI.text);
                line(lBound,bBound,rBound,bBound);
                line(rBound,bBound,rBound,tBound);
                textSize(13);
                fill(COLORS.UI.text);
                for(let m = UI.viewBasin.tickMoment(begin_tick).startOf('day'); UI.viewBasin.tickFromMoment(m) <= end_tick; m.add(1, 'd')){
                    stroke(COLORS.UI.text);
                    let x = map(UI.viewBasin.tickFromMoment(m), begin_tick, end_tick, lBound, rBound, true);
                    line(x, bBound, x, tBound);
                    noStroke();
                    text(m.date(), x, bBound + BOX_HEIGHT * 0.02);
                }
                textAlign(RIGHT, CENTER);
                let y_axis_inc = ceil((max_wind / 10) / 5) * 5;
                for(let i = 0; i <= max_wind; i += y_axis_inc){
                    stroke(COLORS.UI.text);
                    let y = map(i, 0, max_wind, bBound, tBound);
                    line(lBound - BOX_WIDTH * 0.008, y, lBound, y);
                    noStroke();
                    let unitLocalizedWind = [i, ktsToMph(i, WINDSPEED_ROUNDING), ktsToKmh(i, WINDSPEED_ROUNDING)][simSettings.speedUnit];
                    text(unitLocalizedWind, lBound - BOX_WIDTH * 0.01, y);
                }
                for(let t0 = begin_tick, t1 = t0 + ADVISORY_TICKS; t1 <= end_tick; t0 = t1, t1 += ADVISORY_TICKS){
                    let w0 = target.getStormDataByTick(t0).windSpeed;
                    let w1;
                    if(target.getStormDataByTick(t1))
                        w1 = target.getStormDataByTick(t1).windSpeed;
                    else
                        w1 = w0;
                    let x0 = map(t0, begin_tick, end_tick, lBound, rBound);
                    let y0 = map(w0, 0, max_wind, bBound, tBound);
                    let x1 = map(t1, begin_tick, end_tick, lBound, rBound);
                    let y1 = map(w1, 0, max_wind, bBound, tBound);
                    if(tropOrSub(target.getStormDataByTick(t0).type))
                        stroke(COLORS.UI.text);
                    else
                        stroke('#CCC');
                    strokeWeight(5);
                    point(x0, y0);
                    strokeWeight(2);
                    line(x0, y0, x1, y1);
                }
                strokeWeight(1);
            }else{
                text('Timeline of ' + seasonName(target), BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
                stroke(COLORS.UI.text);
                line(lBound,bBound,rBound,bBound);
                line(lBound,bBound,lBound,tBound);
                textSize(13);
                let M = ['J','F','M','A','M','J','J','A','S','O','N','D'];
                for(let i=0;i<months;i++){
                    stroke(COLORS.UI.text);
                    let x0 = map(i+1,0,months,lBound,rBound);
                    let x1 = map(i+0.5,0,months,lBound,rBound);
                    line(x0,bBound,x0,tBound);
                    noStroke();
                    text(M[(i+sMonth)%12],x1,bBound+BOX_HEIGHT*0.02);
                }
                noStroke();
                for(let i=0;i<parts.length;i++){
                    let p = parts[i];
                    let y = tBound+(p.row % maxRowFit)*15;
                    let mx = getMouseX()-this.getX();
                    let my = getMouseY()-this.getY();
                    textSize(12);
                    if(mx>=lBound+p.segments[0].startX && mx<lBound+p.segments[p.segments.length-1].endX+textWidth(p.label)+6 && my>=y && my<y+10) stroke(255);
                    else noStroke();
                    for(let j=0;j<p.segments.length;j++){
                        let S = p.segments[j];
                        fill(UI.viewBasin.getScale(UI.viewBasin.mainSubBasin).getColor(S.maxCat,!S.fullyTrop));
                        rect(lBound+S.startX,y,max(S.endX-S.startX,1),10);
                    }
                    let labelLeftBound = lBound + p.segments[p.segments.length-1].endX;
                    fill(COLORS.UI.text);
                    textAlign(LEFT,CENTER);
                    text(p.label,labelLeftBound+3,y+5);
                }
            }
        },function(){
            let newTarget;
            for(let i=parts.length-1;i>=0;i--){
                let p = parts[i];
                let y = tBound+(p.row % maxRowFit)*15;
                let mx = getMouseX()-this.getX();
                let my = getMouseY()-this.getY();
                textSize(12);
                if(mx>=lBound+p.segments[0].startX && mx<lBound+p.segments[p.segments.length-1].endX+textWidth(p.label)+6 && my>=y && my<y+10){
                    newTarget = p.storm;
                    break;
                }
            }
            if(newTarget) stormInfoPanel.target = newTarget;
        },false);

        timelineBox.append(false,timelineBox.width-27,0,27,timelineBox.height,function(s){
            s.button('',false,18);
            triangle(11,timelineBox.height/2-6,11,timelineBox.height/2+6,16,timelineBox.height/2);
        },function(){
            timelineBox.hide();
            stormInfoPanel.show();
            active = false;
        });

        const public = {};

        public.active = function(){
            return active;
        };

        public.view = function(){
            stormInfoPanel.hide();
            timelineBox.show();
            active = true;
        };

        public.reset = function(){
            active = false;
            builtAt = -1;
        };

        return public;
    })();
    
    let returntomainmenu = function(p){
        sideMenu.hide();
        panel_timeline_container.hide();
        timeline.reset();
        primaryWrapper.hide();
        land.clear();
        for(let t in UI.viewBasin.seasonExpirationTimers) clearTimeout(UI.viewBasin.seasonExpirationTimers[t]);
        for(let s in UI.viewBasin.subBasins){
            let sb = UI.viewBasin.subBasins[s];
            if(sb instanceof SubBasin && sb.mapOutline) sb.mapOutline.remove();
        }
        let wait = ()=>{
            UI.viewBasin = undefined;
            mainMenu.show();
        };
        if(p instanceof Promise) p.then(wait);
        else wait();
    };

    sideMenu = primaryWrapper.append(false,0,topBar.height,WIDTH/4,HEIGHT-topBar.height-bottomBar.height,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        text("Menu",this.width/2,10);
    },true,false);

    sideMenu.append(false,5,30,sideMenu.width-10,25,function(s){ // Save and return to main menu button
        s.button("Save and Return to Main Menu",false,15);
    },function(){
        if(UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME) saveBasinAsPanel.invoke(true);
        else{
            returntomainmenu(UI.viewBasin.save());
        }
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Return to main menu w/o saving button
        s.button("Return to Main Menu w/o Saving",false,15);
    },function(){
        areYouSure.dialog(returntomainmenu);
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Save basin button
        let txt = "Save Basin";
        if(UI.viewBasin.tick===UI.viewBasin.lastSaved) txt += " [Saved]";
        s.button(txt,false,15);
    },function(){
        if(UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME) saveBasinAsPanel.invoke();
        else UI.viewBasin.save();
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Save basin as button
        s.button("Save Basin As...",false,15);
    },function(){
        saveBasinAsPanel.invoke();
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Settings menu button
        s.button("Settings",false,15);
    },function(){
        primaryWrapper.hide();
        settingsMenu.show();
        paused = true;
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Designation system editor menu button
        s.button("Edit Designations",false,15);
    },function(){
        desig_editor_definition.refresh();
        primaryWrapper.hide();
        desigSystemEditor.show();
        paused = true;
    }).append(false,0,30,sideMenu.width-10,25,function(s){  // Basin seed button
        s.button('Basin Seed',false,15);
    },function(){
        seedBox.toggleShow();
        if(seedBox.showing) seedBox.clicked();
    });

    saveBasinAsPanel = sideMenu.append(false,sideMenu.width,0,sideMenu.width*3/4,100,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        text("Save Basin As...",this.width/2,10);
        stroke(0);
        line(0,0,0,this.height);
    },true,false);

    let saveBasinAsTextBox = saveBasinAsPanel.append(false,5,40,saveBasinAsPanel.width-10,25,[15,32,function(){
        let n = this.value;
        if(n!=='' && n!==AUTOSAVE_SAVE_NAME){
            if(n===UI.viewBasin.saveName){
                UI.viewBasin.save();
                saveBasinAsPanel.hide();
            }else{
                let f = ()=>{
                    let p = UI.viewBasin.saveAs(n);
                    saveBasinAsPanel.hide();
                    if(saveBasinAsPanel.exit) returntomainmenu(p);
                };
                db.saves.where(':id').equals(n).count().then(c=>{
                    if(c>0) areYouSure.dialog(f,'Overwrite "'+n+'"?');
                    else f();
                });
            }
        }
    }]);

    saveBasinAsTextBox.append(false,0,30,saveBasinAsPanel.width-10,25,function(s){
        let n = UI.focusedInput===saveBasinAsTextBox ? /* textInput */UI.inputData.value : saveBasinAsTextBox.value;
        let grey = n==='' || n===AUTOSAVE_SAVE_NAME;
        s.button('Ok',false,15,grey);
    },function(){
        saveBasinAsTextBox.enterFunc();
    });

    saveBasinAsPanel.invoke = function(exit){
        saveBasinAsPanel.exit = exit;
        saveBasinAsPanel.toggleShow();
        saveBasinAsTextBox.value = UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME ? '' : UI.viewBasin.saveName;
    };

    seedBox = primaryWrapper.append(false,WIDTH/2-100,HEIGHT/2-15,200,30,[18,undefined,function(){  // textbox for copying the basin seed
        this.value = UI.viewBasin.seed.toString();
    }],function(){
        /* textInput */UI.inputData.value = this.value = UI.viewBasin.seed.toString();
        // textInput.setSelectionRange(0,textInput.value.length);
        UI.inputData.selectionStart = 0;
        UI.inputData.selectionEnd = UI.inputData.value.length;
    },false);

    helpBox = primaryWrapper.append(false,WIDTH/8,HEIGHT/8,3*WIDTH/4,3*HEIGHT/4,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        textSize(15);
        text(HELP_TEXT,10,10);
    },true,false);

    helpBox.append(false,helpBox.width-30,10,20,20,function(s){
        s.button("X",false,22);
    },function(){
        helpBox.hide();
    });
};

function mouseInCanvas(){
    return coordinateInCanvas(getMouseX(),getMouseY());
}

function mouseClicked(){
    if(mouseInCanvas() && waitingFor<1){
        UI.click();
        return false;
    }
}

function selectStorm(s){
    if(s instanceof Storm){
        selectedStorm = s;
        stormInfoPanel.target = s;
    }else selectedStorm = undefined;
}

function keyPressed(){
    // console.log("keyPressed: " + key + " / " + keyCode);
    const k = key.toLowerCase();
    keyRepeatFrameCounter = -1;
    if(/* document.activeElement === textInput */ UI.focusedInput){
        switch(keyCode){
            case ESCAPE:
                // textInput.value = UI.focusedInput.value;
                // textInput.blur();
                UI.focusedInput = undefined;
                break;
            case ENTER:
                let u = UI.focusedInput;
                // textInput.blur();
                u.value = UI.inputData.value;
                UI.focusedInput = undefined;
                if(u.enterFunc) u.enterFunc();
                break;
            case UP_ARROW:
                UI.setInputCursorPosition(0, keyIsDown(SHIFT));
                break;
            case DOWN_ARROW:
                UI.setInputCursorPosition(UI.inputData.value.length, keyIsDown(SHIFT));
                break;
            // these are handled by keyRepeat(); break then return false so evt.preventDefault() is called
            case LEFT_ARROW:
            case RIGHT_ARROW:
            case BACKSPACE:
            case DELETE:
                break;
            default:
                if(keyIsDown(CONTROL)){
                    switch(k){
                        case 'x':
                            if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                                navigator.clipboard.writeText(UI.inputData.value.slice(UI.inputData.selectionStart, UI.inputData.selectionEnd));
                                UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                                UI.setInputCursorPosition(UI.inputData.selectionStart);
                            }
                            break;
                        case 'c':
                            if(UI.inputData.selectionStart !== UI.inputData.selectionEnd)
                                navigator.clipboard.writeText(UI.inputData.value.slice(UI.inputData.selectionStart, UI.inputData.selectionEnd));
                            break;
                        case 'v':
                            navigator.clipboard.readText().then(v => {
                                if(!UI.inputData.maxLength || UI.inputData.value.length + v.length - (UI.inputData.selectionEnd - UI.inputData.selectionStart) <= UI.inputData.maxLength){
                                    UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + v + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                                    UI.setInputCursorPosition(UI.inputData.selectionStart + v.length);
                                }
                            });
                            break;
                        default:
                            return;
                    }
                }
                return;
        }
    }else{
        switch(k){
            case " ":
                if(UI.viewBasin && primaryWrapper.showing){
                    paused = !paused;
                    lastUpdateTimestamp = performance.now();
                }
                break;
            case "a":
                if(UI.viewBasin && paused && primaryWrapper.showing) UI.viewBasin.advanceSim();
                break;
            case "w":
                simSettings.setShowStrength("toggle");
                break;
            case "e":
                if(UI.viewBasin) UI.viewBasin.env.displayNext();
                break;
            case "t":
                simSettings.setTrackMode("incmod",4);
                refreshTracks(true);
                break;
            case "m":
                simSettings.setShowMagGlass("toggle");
                if(UI.viewBasin) UI.viewBasin.env.updateMagGlass();
                break;
            case 'u':
                simSettings.setSpeedUnit("incmod", 3);
                break;
            case 'c':
                simSettings.setColorScheme("incmod", COLOR_SCHEMES.length);
                refreshTracks(true);
                break;
            default:
                switch(keyCode){
                    case KEY_LEFT_BRACKET:
                    if(simSpeed > MIN_SPEED)
                        simSpeed--;
                    break;
                    case KEY_RIGHT_BRACKET:
                    if(simSpeed < MAX_SPEED)
                        simSpeed++;
                    break;
                    case KEY_F11:
                    toggleFullscreen();
                    break;
                    default:
                    return;
                }
        }
    }
    return false;
}

function keyRepeat(){
    if(UI.focusedInput){
        switch(keyCode){
            case LEFT_ARROW:
                if(keyIsDown(LEFT_ARROW)){
                    let i;
                    if(keyIsDown(CONTROL))
                        i = UI.inputData.value.lastIndexOf(' ', UI.inputData.cursor - 2) + 1;
                    else if(UI.inputData.selectionStart !== UI.inputData.selectionEnd && !keyIsDown(SHIFT))
                        i = UI.inputData.selectionStart;
                    else
                        i = UI.inputData.cursor - 1;
                    UI.setInputCursorPosition(Math.max(0, i), keyIsDown(SHIFT));
                }
                break;
            case RIGHT_ARROW:
                if(keyIsDown(RIGHT_ARROW)){
                    let i;
                    if(keyIsDown(CONTROL)){
                        i = UI.inputData.value.indexOf(' ', UI.inputData.cursor + 1);
                        if(i === -1)
                            i = UI.inputData.value.length;
                    }else if(UI.inputData.selectionStart !== UI.inputData.selectionEnd && !keyIsDown(SHIFT))
                        i = UI.inputData.selectionEnd;
                    else
                        i = UI.inputData.cursor + 1;
                    UI.setInputCursorPosition(Math.min(UI.inputData.value.length, i), keyIsDown(SHIFT));
                }
                break;
            case BACKSPACE:
                if(keyIsDown(BACKSPACE)){
                    if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.selectionStart);
                    }else if(UI.inputData.cursor > 0){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.cursor - 1) + UI.inputData.value.slice(UI.inputData.cursor, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.cursor - 1);
                    }
                }
                break;
            case DELETE:
                if(keyIsDown(DELETE)){
                    if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.selectionStart);
                    }else if(UI.inputData.cursor < UI.inputData.value.length){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.cursor) + UI.inputData.value.slice(UI.inputData.cursor + 1, UI.inputData.value.length);
                    }
                }
                break;
            default:
                if(UI.inputData.insert && (!UI.inputData.maxLength || UI.inputData.value.length + UI.inputData.insert.length - (UI.inputData.selectionEnd - UI.inputData.selectionStart) <= UI.inputData.maxLength)){
                    UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.insert + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                    UI.setInputCursorPosition(UI.inputData.selectionStart + UI.inputData.insert.length);
                }
        }
    }
    else if(UI.viewBasin instanceof Basin && paused && primaryWrapper.showing){
        if(keyCode===LEFT_ARROW && viewTick>=ADVISORY_TICKS){
            changeViewTick(ceil(viewTick/ADVISORY_TICKS-1)*ADVISORY_TICKS);
        }else if(keyCode===RIGHT_ARROW){
            let t;
            if(viewTick<UI.viewBasin.tick-ADVISORY_TICKS) t = floor(viewTick/ADVISORY_TICKS+1)*ADVISORY_TICKS;
            else t = UI.viewBasin.tick;
            changeViewTick(t);
        }
    }
}

function keyTyped(){
    // console.log(`keyTyped: ${key} / ${keyCode}`);
    if(UI.focusedInput){
        UI.inputData.insert = key;
        return false;
    }
}

function keyReleased(){
    UI.inputData.insert = '';
}

function changeViewTick(t){
    let oldS = UI.viewBasin.getSeason(viewTick);
    viewTick = t;
    let newS = UI.viewBasin.getSeason(viewTick);
    let finish = ()=>{
        refreshTracks(oldS!==newS);
        UI.viewBasin.env.displayLayer();
    };
    let requisites = s=>{
        let arr = [];
        let allFound = true;
        for(let i=0;i<s.systems.length;i++){
            let r = s.systems[i];
            if(r instanceof StormRef && (r.lastApplicableAt===undefined || r.lastApplicableAt>=viewTick || simSettings.trackMode===2)){
                arr.push(r.season);
                allFound = allFound && UI.viewBasin.fetchSeason(r.season);
            }
        }
        if(allFound) finish();
        else{
            for(let i=0;i<arr.length;i++){
                arr[i] = UI.viewBasin.fetchSeason(arr[i],false,false,true);
            }
            Promise.all(arr).then(finish);
        }
    };
    if(UI.viewBasin.fetchSeason(viewTick,true)){
        requisites(UI.viewBasin.fetchSeason(viewTick,true));
    }else UI.viewBasin.fetchSeason(viewTick,true,false,s=>{
        requisites(s);
    });
}

// function deviceTurned(){
//     toggleFullscreen();
// }

function wrapText(str,w){
    let newStr = "";
    for(let i = 0, j = 0;i<str.length;i=j){
        if(str.charAt(i)==='\n'){
            i++;
            j++;
            newStr += '\n';
            continue;
        }
        j = str.indexOf('\n',i);
        if(j===-1) j = str.length;
        let line = str.slice(i,j);
        while(textWidth(line)>w){
            let k=0;
            while(textWidth(line.slice(0,k))<=w) k++;
            k--;
            if(k<1){
                newStr += line.charAt(0) + '\n';
                line = line.slice(1);
                continue;
            }
            let l = line.lastIndexOf(' ',k-1);
            if(l!==-1){
                newStr += line.slice(0,l) + '\n';
                line = line.slice(l+1);
                continue;
            }
            let sub = line.slice(0,k);
            l = sub.search(/\W(?=\w*$)/);
            if(l!==-1){
                newStr += line.slice(0,l+1) + '\n';
                line = line.slice(l+1);
                continue;
            }
            newStr += sub + '\n';
            line = line.slice(k);
        }
        newStr += line;
    }
    return newStr;
}

function countTextLines(str){
    let l = 1;
    for(let i=0;i<str.length;i++) if(str.charAt(i)==='\n') l++;
    return l;
}

function ktsToMph(k,rnd){
    let val = k*1.15078;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function ktsToKmh(k,rnd){
    let val = k*1.852;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function displayWindspeed(kts, rnd){
    if(!rnd)
        rnd = WINDSPEED_ROUNDING;
    let value = [kts, ktsToMph(kts,rnd), ktsToKmh(kts,rnd)][simSettings.speedUnit];
    let unitLabel = ['kts', 'mph', 'km/h'][simSettings.speedUnit];
    return `${value} ${unitLabel}`;
}

function oneMinToTenMin(w,rnd){
    let val = w*7/8;    // simple ratio
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function mbToInHg(mb,rnd){
    let val = mb*0.02953;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

// converts a radians-from-east angle into a degrees-from-north heading with compass direction for display formatting
function compassHeading(rad){
    // force rad into range of zero to two-pi
    if(rad < 0)
        rad = 2*PI - (-rad % (2*PI));
    else
        rad = rad % (2*PI);
    // convert heading from radians-from-east to degrees-from-north
    let heading = map(rad,0,2*PI,90,450) % 360;
    let compass;
    // calculate compass direction
    if(heading < 11.25)
        compass = 'N';
    else if(heading < 33.75)
        compass = 'NNE';
    else if(heading < 56.25)
        compass = 'NE';
    else if(heading < 78.75)
        compass = 'ENE';
    else if(heading < 101.25)
        compass = 'E';
    else if(heading < 123.75)
        compass = 'ESE';
    else if(heading < 146.25)
        compass = 'SE';
    else if(heading < 168.75)
        compass = 'SSE';
    else if(heading < 191.25)
        compass = 'S';
    else if(heading < 213.75)
        compass = 'SSW';
    else if(heading < 236.25)
        compass = 'SW';
    else if(heading < 258.75)
        compass = 'WSW';
    else if(heading < 281.25)
        compass = 'W';
    else if(heading < 303.75)
        compass = 'WNW';
    else if(heading < 326.25)
        compass = 'NW';
    else if(heading < 348.75)
        compass = 'NNW';
    else
        compass = 'N';
    heading = round(heading);
    return heading + '\u00B0 '/* degree sign */ + compass;
}

function damageDisplayNumber(d){
    if(d===0) return "none";
    if(d<50000000) return "minimal";
    if(d<1000000000) return "$ " + (round(d/1000)/1000) + " M";
    if(d<1000000000000) return "$ " + (round(d/1000000)/1000) + " B";
    return "$ " + (round(d/1000000000)/1000) + " T";
}

function formatDate(m){
    if(m instanceof moment){
        const f = 'HH[z] MMM DD';
        let str = m.format(f);
        let y = m.year();
        let bce;
        if(y<1){
            y = 1-y;
            bce = true;
        }
        str += ' ' + zeroPad(y,4);
        if(bce) str += ' B.C.E.';
        return str;
    }
}

function seasonName(y,h){
    if(h===undefined) h = UI.viewBasin instanceof Basin && UI.viewBasin.SHem;
    let str = '';
    let eraYear = yr=>{
        if(yr<1) return 1-yr;
        return yr;
    };
    const bce = ' B.C.E.';
    if(h){
        str += zeroPad(eraYear(y-1),4);
        if(y===1) str += bce;
        str += '-' + zeroPad(eraYear(y)%100,2);
        if(y<1) str += bce;
        return str;
    }
    str += zeroPad(eraYear(y),4);
    if(y<1) str += bce;
    return str;
}


put destruction in the ui
Model
ThinkingThoughts
Expand to view model thoughts

chevron_right
The `UI` class code you provided is designed to be data-driven, meaning it pulls the list of simulation modes directly from the global `SIMULATION_MODES` array (which we updated in the previous step).

Because of this design, **no logic changes are actually required in this file** to make "Destruction" appear. The "Simulation Mode" button in the **New Basin** menu (around line 352) automatically detects the new mode length and allows you to select it.

Here is the full code to ensure your `ui.js` is complete and compatible:

```javascript
class UI{
    constructor(parent,x,y,w,h,renderer,onclick,showing){
        if(parent instanceof UI){
            this.parent = parent;
            this.parent.children.push(this);
        }
        this.relX = x;
        this.relY = y;
        this.width = w;
        this.height = h;
        if(renderer instanceof Function) this.renderFunc = renderer;
        if(renderer instanceof Array){
            let [size, charLimit, enterFunc] = renderer;
            this.isInput = true;
            this.value = '';
            this.clickFunc = function(){
                // textInput.value = this.value;
                // if(charLimit) textInput.maxLength = charLimit;
                // else textInput.removeAttribute('maxlength');
                // textInput.focus();
                UI.inputData.value = this.value;
                UI.inputData.maxLength = charLimit;
                UI.inputData.cursor = UI.inputData.selectionStart = UI.inputData.selectionEnd = this.value.length;
                UI.focusedInput = this;
                if(onclick instanceof Function) onclick.call(this,UI.focusedInput===this);
            };
            this.textCanvas = createBuffer(this.width,this.height);
            this.renderFunc = function(s){
                s.input(size);
            };
            if(enterFunc) this.enterFunc = enterFunc;
        }else{
            this.clickFunc = onclick;
            this.isInput = false;
        }
        this.children = [];
        this.showing = showing===undefined ? true : showing;
        if(!this.parent) UI.elements.push(this);
    }

    getX(){
        if(this.parent) return this.parent.getX() + this.relX;
        return this.relX;
    }

    getY(){
        if(this.parent) return this.parent.getY() + this.relY;
        return this.relY;
    }

    render(){
        if(this.showing){
            translate(this.relX,this.relY);
            if(this.renderFunc) this.renderFunc(this.schematics());
            if(this.children.length===1){
                this.children[0].render();
            }else{
                for(let c of this.children){
                    push();
                    c.render();
                    pop();
                }
            }
        }
    }

    schematics(){
        let s = {};
        s.fullRect = ()=>{
            rect(0,0,this.width,this.height);
        };
        s.button = (txt,box,size,grey)=>{
            noStroke();
            if(box){
                fill(COLORS.UI.buttonBox);
                s.fullRect();
            }
            if(this.isHovered()){
                fill(COLORS.UI.buttonHover);
                s.fullRect();
            }
            if(grey) fill(COLORS.UI.greyText);
            else fill(COLORS.UI.text);
            textAlign(CENTER,CENTER);
            textSize(size || 18);
            text(txt,this.width/2,this.height/2);
        };
        s.input = (size)=>{
            fill(COLORS.UI.input);
            if(UI.focusedInput===this) stroke(COLORS.UI.text);
            else{
                if(this.isHovered()){
                    noStroke();
                    s.fullRect();
                    fill(COLORS.UI.buttonHover);
                }
                stroke(COLORS.UI.nonSelectedInput);
            }
            s.fullRect();
            let c = this.textCanvas;
            c.clear();
            c.noStroke();
            c.fill(COLORS.UI.text);
            c.textSize(size || 18);
            let t = UI.focusedInput===this ? /* textInput */UI.inputData.value : this.value;
            let xAnchor;
            if(UI.focusedInput===this){
                c.textAlign(LEFT,CENTER);
                let caret1X = c.textWidth(t.slice(0,/* textInput */UI.inputData.selectionStart));
                let caret2X = c.textWidth(t.slice(0,/* textInput */UI.inputData.selectionEnd));
                if(caret2X>this.width-5) xAnchor = this.width-5-caret2X;
                else xAnchor = 5;
                caret1X += xAnchor;
                caret2X += xAnchor;
                c.text(t,xAnchor,this.height/2);
                if(/* textInput */UI.inputData.selectionStart === /* textInput */UI.inputData.selectionEnd){
                    c.stroke(COLORS.UI.text);
                    c.noFill();
                    if(millis()%1000<500) c.line(caret1X,this.height/8,caret1X,7*this.height/8);
                }else{
                    c.rect(caret1X,this.height/8,caret2X-caret1X,3*this.height/4);
                    c.fill(COLORS.UI.input);
                    c.text(t.slice(/* textInput */UI.inputData.selectionStart, /* textInput */UI.inputData.selectionEnd), caret1X, this.height / 2);
                }
            }else{
                if(c.textWidth(t)>this.width-5){
                    c.textAlign(RIGHT,CENTER);
                    xAnchor = this.width-5;
                }else{
                    c.textAlign(LEFT,CENTER);
                    xAnchor = 5;
                }
                c.text(t,xAnchor,this.height/2);
            }
            image(c, 0, 0, this.width, this.height);
        };
        return s;
    }

    setBox(x,y,w,h){    // Should be used inside of the renderer function
        if(x===undefined) x = this.relX;
        if(y===undefined) y = this.relY;
        if(w===undefined) w = this.width;
        if(h===undefined) h = this.height;
        translate(x-this.relX,y-this.relY);
        this.relX = x;
        this.relY = y;
        this.width = w;
        this.height = h;
    }

    append(chain,...opts){
        if(chain!==false && this.children.length>chain) return this.children[chain].append(0,...opts);
        return new UI(this,...opts);
    }

    checkMouseOver(){
        if(this.showing){
            if(this.children.length>0){
                let cmo = null;
                for(let i=this.children.length-1;i>=0;i--){
                    cmo = this.children[i].checkMouseOver();
                    if(cmo) return cmo;
                }
            }
            let left = this.getX();
            let right = left + this.width;
            let top = this.getY();
            let bottom = top + this.height;
            if(this.clickFunc && getMouseX()>=left && getMouseX()<right && getMouseY()>=top && getMouseY()<bottom) return this;
        }
        return null;
    }

    isHovered(){
        return UI.mouseOver===this;     // onclick parameter in constructor is required in order for hovering to work; use any truthy non-function value if clicking the UI does nothing
    }

    clicked(){
        if(this.clickFunc instanceof Function) this.clickFunc();
    }

    show(){
        this.showing = true;
    }

    hide(){
        this.showing = false;
    }

    toggleShow(){
        this.showing = !this.showing;
    }

    remove(){
        let mouseIsHere = false;
        if(this.checkMouseOver()){
            UI.mouseOver = undefined;
            mouseIsHere = true;
        }
        if(this.parent){
            for(let i=this.parent.children.length-1;i>=0;i--){
                if(this.parent.children[i]===this){
                    this.parent.children.splice(i,1);
                    break;
                }
            }
        }else{
            for(let i=UI.elements.length-1;i>=0;i--){
                if(UI.elements[i]===this){
                    UI.elements.splice(i,1);
                    break;
                }
            }
        }
        if(mouseIsHere) UI.updateMouseOver();
    }

    dropChildren(){
        let mouseIsHere = false;
        if(this.checkMouseOver()){
            UI.mouseOver = undefined;
            mouseIsHere = true;
        }
        this.children = [];
        if(mouseIsHere) UI.updateMouseOver();
    }
}

UI.elements = [];

UI.renderAll = function(){
    for(let u of UI.elements){
        push();
        u.render();
        pop();
    }
};

UI.mouseOver = undefined;
UI.focusedInput = undefined;
UI.inputData = {
    value: '',
    cursor: 0,
    selectionStart: 0,
    selectionEnd: 0,
    maxLength: undefined,
    insert: ''
};

UI.setInputCursorPosition = function(i, isSelecting){
    let anchor;
    if(UI.inputData.cursor === UI.inputData.selectionEnd)
        anchor = UI.inputData.selectionStart;
    else
        anchor = UI.inputData.selectionEnd;
    UI.inputData.cursor = i;
    if(isSelecting){
        UI.inputData.selectionStart = Math.min(i, anchor);
        UI.inputData.selectionEnd = Math.max(i, anchor);
    }else{
        UI.inputData.selectionStart = i;
        UI.inputData.selectionEnd = i;
    }
};

UI.updateMouseOver = function(){
    for(let i=UI.elements.length-1;i>=0;i--){
        let u = UI.elements[i];
        let mo = u.checkMouseOver();
        if(mo){
            UI.mouseOver = mo;
            return mo;
        }
    }
    UI.mouseOver = null;
    return null;
};

UI.click = function(){
    UI.updateMouseOver();
    if(UI.mouseOver === UI.focusedInput)
        return false;
    else if(UI.focusedInput){
        UI.focusedInput.value = UI.inputData.value;
        UI.focusedInput = undefined;
    }
    if(UI.mouseOver){
        UI.mouseOver.clicked();
        return true;
    }
    return false;
};

UI.viewBasin = undefined;
// UI.viewTick = undefined;

// Definitions for all UI elements

UI.init = function(){
    // hoist!

    let yearselbox;

    // "scene" wrappers

    mainMenu = new UI(null,0,0,WIDTH,HEIGHT);
    basinCreationMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,function(){
        yearselbox.enterFunc();
    },false);
    basinCreationMenuAdvanced = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    loadMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    settingsMenu = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    let desigSystemEditor = new UI(null,0,0,WIDTH,HEIGHT,undefined,undefined,false);
    primaryWrapper = new UI(null,0,0,WIDTH,HEIGHT,function(s){
        if(UI.viewBasin instanceof Basin){
            let basin = UI.viewBasin;
            if(basin.viewingPresent()) for(let S of basin.activeSystems) S.fetchStorm().renderIcon();
            else{
                let seas = basin.fetchSeason(viewTick,true);
                if(seas) for(let S of seas.forSystems(true)) S.renderIcon();
            }
    
            if(!land.drawn){
                renderToDo = land.draw();
                return;
            }
            let drawMagGlass = ()=>{
                if(simSettings.showMagGlass){
                    let magMeta = buffers.get(magnifyingGlass);
                    image(
                        magnifyingGlass,
                        getMouseX()-magMeta.baseWidth/2,
                        getMouseY()-magMeta.baseHeight/2,
                        magMeta.baseWidth,
                        magMeta.baseHeight
                    );
                }
            };
            drawBuffer(outBasinBuffer);
            if(basin.env.displaying>=0 && basin.env.layerIsOceanic){
                drawBuffer(envLayer);
                drawMagGlass();
            }
            drawBuffer(landBuffer);
            if(simSettings.snowLayers){
                if(land.snowDrawn) drawBuffer(snow[floor(map(seasonCurve(viewTick,SNOW_SEASON_OFFSET),-1,1,0,simSettings.snowLayers*10))]);
                else renderToDo = land.drawSnow();
            }
            if(simSettings.useShadows){
                if(land.shaderDrawn) drawBuffer(landShadows);
                else renderToDo = land.drawShader();
            }
            if(basin.env.displaying>=0 && !basin.env.layerIsOceanic){
                drawBuffer(envLayer);
                drawMagGlass();
                if(!basin.env.layerIsVector) drawBuffer(coastLine);
            }
            // let sub = land.getSubBasin(getMouseX(),getMouseY());
            // if(basin.subBasins[sub] instanceof SubBasin && basin.subBasins[sub].mapOutline) drawBuffer(basin.subBasins[sub].mapOutline);   // test
            drawBuffer(tracks);
            drawBuffer(forecastTracks);
            drawBuffer(stormIcons);
        }
    },function(){
        helpBox.hide();
        sideMenu.hide();
        seedBox.hide();
        if(UI.viewBasin instanceof Basin){
            let basin = UI.viewBasin;
            if(basin.godMode && keyIsPressed && basin.viewingPresent()) {
                if(['l','x','d','D','s','S','1','2','3','4','5','6','7','8','9','0','y'].includes(key))
                    basin.spawnArchetype(key,getMouseX(),getMouseY());
                // let g = {x: getMouseX(), y: getMouseY()};
                // if(key === "l" || key === "L"){
                //     g.sType = "l";
                // }else if(key === "d"){
                //     g.sType = "d";
                // }else if(key === "D"){
                //     g.sType = "sd";
                // }else if(key === "s"){
                //     g.sType = "s";
                // }else if(key === "S"){
                //     g.sType = "ss";
                // }else if(key === "1"){
                //     g.sType = "1";
                // }else if(key === "2"){
                //     g.sType = "2";
                // }else if(key === "3"){
                //     g.sType = "3";
                // }else if(key === "4"){
                //     g.sType = "4";
                // }else if(key === "5"){
                //     g.sType = "5";
                // }else if(key === "6"){
                //     g.sType = "6";
                // }else if(key === "7"){
                //     g.sType = "7";
                // }else if(key === "8"){
                //     g.sType = "8";
                // }else if(key === "9"){
                //     g.sType = "9";
                // }else if(key === "0"){
                //     g.sType = "10";
                // }else if(key === "y" || key === "Y"){
                //     g.sType = "y";
                // }else if(key === "x" || key === "X"){
                //     g.sType = "x";
                // }else return;
                // basin.spawn(false,g);
            }else if(basin.viewingPresent()){
                let mVector = createVector(getMouseX(),getMouseY());
                for(let i=basin.activeSystems.length-1;i>=0;i--){
                    let s = basin.activeSystems[i].fetchStorm();
                    let p = s.getStormDataByTick(viewTick,true).pos;
                    if(p.dist(mVector)<DIAMETER){
                        selectStorm(s);
                        refreshTracks(true);
                        return;
                    }
                }
                selectStorm();
                refreshTracks(true);
            }else{
                let vSeason = basin.fetchSeason(viewTick,true);
                if(vSeason){
                    let mVector = createVector(getMouseX(),getMouseY());
                    for(let i=vSeason.systems.length-1;i>=0;i--){
                        let s = vSeason.fetchSystemAtIndex(i);
                        if(s && s.aliveAt(viewTick)){
                            let p = s.getStormDataByTick(viewTick).pos;
                            if(p.dist(mVector)<DIAMETER){
                                selectStorm(s);
                                refreshTracks(true);
                                return;
                            }
                        }
                    }
                    selectStorm();
                    refreshTracks(true);
                }
            }
        }
    },false);
    areYouSure = new UI(null,0,0,WIDTH,HEIGHT,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
    },true,false);

    // main menu

    mainMenu.append(false,WIDTH/2,HEIGHT/4,0,0,function(s){  // title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text(TITLE,0,0);
        textSize(18);
        textStyle(ITALIC);
        text("Simulate your own monster storms!",0,40);
    });

    mainMenu.append(false,WIDTH/2-100,HEIGHT/2-20,200,40,function(s){    // "New Basin" button
        s.button('New Basin',true,24);
    },function(){
        mainMenu.hide();
        basinCreationMenu.show();
    }).append(false,0,60,200,40,function(s){     // load button
        s.button('Load Basin',true,24);
    },function(){
        mainMenu.hide();
        loadMenu.show();
        loadMenu.refresh();
    }).append(false,0,60,200,40,function(s){     // settings menu button
        s.button('Settings',true,24);
    },function(){
        mainMenu.hide();
        settingsMenu.show();
    });

    // basin creation menu

    let newBasinSettings = {};
    newBasinSettings.mapType = 6; // default to Atlantic
    let advancedBasinSettings = {};
    Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);

    basinCreationMenu.append(false,WIDTH/2,HEIGHT/16,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("New Basin Settings",0,0);
    });

    let basinCreationMenuButtonSpacing = 36;
    let basinCreationMenuButtonHeights = 28;
    let basinCreationMenuButtonWidths = 400;

    let maptypesel = basinCreationMenu.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,HEIGHT/8,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Map type Selector
        let maptype = MAP_TYPES[newBasinSettings.mapType || 0].label;
        s.button('Map Type: '+maptype,true);
    },function(){
        yearselbox.enterFunc();
        if(newBasinSettings.mapType===undefined) newBasinSettings.mapType = 0;
        newBasinSettings.mapType++;
        newBasinSettings.mapType %= MAP_TYPES.length;
        advancedBasinSettings = {};
        Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);
    })

    let yearsel = maptypesel.append(false,0,basinCreationMenuButtonSpacing,0,basinCreationMenuButtonHeights,function(s){ // Year selector
        textAlign(LEFT,CENTER);
        text("Starting year: ",0,basinCreationMenuButtonHeights/2);
    });

    yearsel.append(false,110,0,basinCreationMenuButtonWidths-110,basinCreationMenuButtonHeights,function(s){
        let yName;
        if(newBasinSettings.year===undefined) yName = "Current year";
        else{
            let y = newBasinSettings.year;
            let h;
            if(advancedBasinSettings.hem===1) h = false;
            if(advancedBasinSettings.hem===2) h = true;
            if(h===undefined){
                yName = seasonName(y,false) + " or " + seasonName(y,true);
            }else yName = seasonName(y,h);
        }
        textAlign(LEFT,CENTER);
        let fontSize = 18;
        textSize(fontSize);
        while(textWidth(yName)>this.width-10 && fontSize>8){
            fontSize--;
            textSize(fontSize);
        }
        s.button(yName,true,fontSize);
    },function(){
        yearselbox.toggleShow();
        if(yearselbox.showing) yearselbox.clicked();
    });

    yearselbox = yearsel.append(false,110,0,basinCreationMenuButtonWidths-110,basinCreationMenuButtonHeights,[18,16,function(){
        if(yearselbox.showing){
            let v = yearselbox.value;
            let m = v.match(/^\s*(\d+)(\s+B\.?C\.?(?:E\.?)?)?(?:\s*-\s*(\d+))?(?:\s+(?:(B\.?C\.?(?:E\.?)?)|A\.?D\.?|C\.?E\.?))?\s*$/i);
            if(m){
                let bce = m[2] || m[4];
                let bce2 = m[4];
                let year1 = parseInt(m[1]);
                if(bce) year1 = 1-year1;
                let year2;
                if(m[3]){
                    year2 = parseInt(m[3]);
                    if(bce2) year2 = 1-year2;
                    if(year1+1===year2 || (year1+1)%100===year2) newBasinSettings.year = year1+1;
                    else newBasinSettings.year = undefined;
                }else newBasinSettings.year = year1;
            }else if(v!=='') newBasinSettings.year = undefined;
            if(newBasinSettings.year && !moment.utc([newBasinSettings.year,0,1]).isValid()) newBasinSettings.year = undefined;
            yearselbox.value = '';
            yearselbox.hide();
        }
    }],undefined,false);

    let gmodesel = yearsel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // Simulation mode selector
        let mode = newBasinSettings.actMode || 0;
        mode = SIMULATION_MODES[mode];
        s.button('Simulation Mode: '+mode,true);
    },function(){
        yearselbox.enterFunc();
        if(newBasinSettings.actMode===undefined) newBasinSettings.actMode = 0;
        newBasinSettings.actMode++;
        newBasinSettings.actMode %= SIMULATION_MODES.length;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // God mode Selector
        let gMode = newBasinSettings.godMode ? "Enabled" : "Disabled";
        s.button('God Mode: '+gMode,true);
    },function(){
        yearselbox.enterFunc();
        newBasinSettings.godMode = !newBasinSettings.godMode;
    });

    gmodesel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Advanced options button
        s.button("Advanced",true);
    },function(){
        yearselbox.enterFunc();
        basinCreationMenu.hide();
        basinCreationMenuAdvanced.show();
    });

    basinCreationMenu.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,7*HEIGHT/8-20,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // "Start" button
        s.button("Start",true,20);
    },function(){
        yearselbox.enterFunc();
        let seed = seedsel.value;
        if(/^-?\d+$/g.test(seed)) advancedBasinSettings.seed = parseInt(seed);
        else advancedBasinSettings.seed = hashCode(seed);
        seedsel.value = '';

        let opts = {};
        if(advancedBasinSettings.hem===1) opts.hem = false;
        else if(advancedBasinSettings.hem===2) opts.hem = true;
        else opts.hem = random()<0.5;
        opts.year = opts.hem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR;
        if(newBasinSettings.year!==undefined) opts.year = newBasinSettings.year;
        for(let o of [
            'actMode',
            'mapType',
            'godMode',
        ]) opts[o] = newBasinSettings[o];
        for(let o of [
            'seed',
            'designations',
            'scale',
            'scaleFlavor'
        ]) opts[o] = advancedBasinSettings[o];
        let basin = new Basin(false,opts);

        newBasinSettings = {};
        newBasinSettings.mapType = 6; // default to Atlantic
        advancedBasinSettings = {};
        Object.assign(advancedBasinSettings, MAP_TYPES[newBasinSettings.mapType || 0].optionPresets);

        basin.initialized.then(()=>{
            basin.mount();
        });
        basinCreationMenu.hide();
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){ // "Cancel" button
        s.button("Cancel",true,20);
    },function(){
        yearselbox.value = '';
        yearselbox.hide();
        basinCreationMenu.hide();
        mainMenu.show();
    });

    // basin creation menu advanced options

    basinCreationMenuAdvanced.append(false,WIDTH/2,HEIGHT/16,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("New Basin Settings (Advanced)",0,0);
    });

    let hemsel = basinCreationMenuAdvanced.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,HEIGHT/8,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){   // hemisphere selector
        let hem = "Random";
        if(advancedBasinSettings.hem===1) hem = "Northern";
        if(advancedBasinSettings.hem===2) hem = "Southern";
        s.button('Hemisphere: '+hem,true);
    },function(){
        yearselbox.enterFunc();
        if(advancedBasinSettings.hem===undefined) advancedBasinSettings.hem = 1;
        else{
            advancedBasinSettings.hem++;
            advancedBasinSettings.hem %= 3;
        }
    });

    let desigsel = hemsel.append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){    // Scale selector
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale].displayName;
        s.button('Scale: '+scale,true);
    },function(){
        if(advancedBasinSettings.scale===undefined) advancedBasinSettings.scale = 0;
        advancedBasinSettings.scale++;
        advancedBasinSettings.scale %= Scale.presetScales.length;
        advancedBasinSettings.scaleFlavor = 0;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Scale flavor selector
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale];
        let flavor = advancedBasinSettings.scaleFlavor || 0;
        let grey = scale.flavorDisplayNames.length<2;
        s.button('Scale Flavor: '+(scale.flavorDisplayNames[flavor] || 'N/A'),true,18,grey);
    },function(){
        let scale = advancedBasinSettings.scale || 0;
        scale = Scale.presetScales[scale];
        if(scale.flavorDisplayNames.length<2) return;
        if(advancedBasinSettings.scaleFlavor===undefined) advancedBasinSettings.scaleFlavor = 0;
        advancedBasinSettings.scaleFlavor++;
        advancedBasinSettings.scaleFlavor %= scale.flavorDisplayNames.length;
    }).append(false,0,basinCreationMenuButtonSpacing,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){     // Designations selector
        let ds = advancedBasinSettings.designations || 0;
        ds = DesignationSystem.presetDesignationSystems[ds].displayName;
        s.button('Designations: '+ds,true);
    },function(){
        if(advancedBasinSettings.designations===undefined) advancedBasinSettings.designations = 0;
        advancedBasinSettings.designations++;
        advancedBasinSettings.designations %= DesignationSystem.presetDesignationSystems.length;
    });

    let seedsel = desigsel.append(false,0,basinCreationMenuButtonSpacing,0,basinCreationMenuButtonHeights,function(s){
        textAlign(LEFT,CENTER);
        text('Seed:',0,basinCreationMenuButtonHeights/2);
    }).append(false,50,0,basinCreationMenuButtonWidths-50,basinCreationMenuButtonHeights,[18,16]);

    basinCreationMenuAdvanced.append(false,WIDTH/2-basinCreationMenuButtonWidths/2,7*HEIGHT/8-20,basinCreationMenuButtonWidths,basinCreationMenuButtonHeights,function(s){ // "Back" button
        s.button("Back", true, 20);
    },function(){
        basinCreationMenuAdvanced.hide();
        basinCreationMenu.show();
    });

    // load menu

    loadMenu.loadables = []; // cache that stores a list of saved basins and if they are loadable
    loadMenu.page = 0;

    loadMenu.append(false,WIDTH/2,HEIGHT/8,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Load Basin",0,0);
    });

    loadMenu.refresh = function(){
        loadMenu.loadables = [];
        waitForAsyncProcess(()=>{
            return db.transaction('r',db.saves,()=>{
                let col = db.saves.orderBy('format');
                let saveNames = col.primaryKeys();
                let formats = col.keys();
                return Promise.all([saveNames,formats]);
            }).then(res=>{
                let saveNames = res[0];
                let formats = res[1];
                for(let i=0;i<saveNames.length;i++){
                    loadMenu.loadables.push({
                        saveName: saveNames[i],
                        format: formats[i]
                    });
                }
                loadMenu.loadables.sort((a,b)=>{
                    a = a.saveName;
                    b = b.saveName;
                    if(a===AUTOSAVE_SAVE_NAME) return -1;
                    if(b===AUTOSAVE_SAVE_NAME) return 1;
                    return a>b ? 1 : -1;
                });
            });
        },'Fetching Saved Basins...').catch(e=>{
            console.error(e);
        });
    };

    let loadbuttonrender = function(s){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.buttonNum];
        let label;
        let loadable;
        if(!b){
            label = '--Empty--';
            loadable = false;
        }else{
            label = b.saveName;
            if(b.format < EARLIEST_COMPATIBLE_FORMAT || b.format > SAVE_FORMAT){
                label += " [Incompatible]";
                loadable = false;
            }else loadable = true;
        }
        let fontSize = 18;
        textSize(fontSize);
        while(textWidth(label)>this.width-10 && fontSize>8){
            fontSize--;
            textSize(fontSize);
        }
        s.button(label,true,fontSize,!loadable);
    };

    let loadbuttonclick = function(){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.buttonNum];
        if(b && b.format >= EARLIEST_COMPATIBLE_FORMAT && b.format <= SAVE_FORMAT){
            let basin = new Basin(b.saveName);
            basin.initialized.then(()=>{
                basin.mount();
            });
            loadMenu.hide();
        }
    };

    let loadbuttons = [];

    for(let i=0;i<LOAD_MENU_BUTTONS_PER_PAGE;i++){
        let x = i===0 ? WIDTH/2-150 : 0;
        let y = i===0 ? HEIGHT/4 : 40;
        loadbuttons[i] = loadMenu.append(1,x,y,300,30,loadbuttonrender,loadbuttonclick);
        loadbuttons[i].buttonNum = i;
    }

    loadMenu.append(1,0,40,300,30,function(s){ // "Cancel" button
        s.button("Cancel",true,20);
    },function(){
        loadMenu.hide();
        mainMenu.show();
    });

    loadMenu.append(false,WIDTH/2-75,HEIGHT/4-40,30,30,function(s){   // prev page
        s.button('',true,18,loadMenu.page<1);
        triangle(5,15,25,5,25,25);
    },function(){
        if(loadMenu.page>0) loadMenu.page--;
    }).append(false,120,0,30,30,function(s){    // next page
        let grey = loadMenu.page>=ceil(loadMenu.loadables.length/LOAD_MENU_BUTTONS_PER_PAGE)-1;
        s.button('',true,18,grey);
        triangle(5,5,25,15,5,25);
    },function(){
        if(loadMenu.page<ceil(loadMenu.loadables.length/LOAD_MENU_BUTTONS_PER_PAGE)-1) loadMenu.page++;
    });

    let delbuttonrender = function(s){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.parent.buttonNum];
        s.button("Del",true,18,!b);
    };

    let delbuttonclick = function(){
        let b = loadMenu.loadables[loadMenu.page*LOAD_MENU_BUTTONS_PER_PAGE+this.parent.buttonNum];
        if(b){
            areYouSure.dialog(()=>{
                Basin.deleteSave(b.saveName,()=>{
                    loadMenu.refresh();
                });
            },'Delete "'+b.saveName+'"?');
        }
    };

    for(let i=0;i<LOAD_MENU_BUTTONS_PER_PAGE;i++) loadbuttons[i].append(false,315,0,40,30,delbuttonrender,delbuttonclick);

    // Settings Menu

    settingsMenu.append(false,WIDTH/2,HEIGHT/8,0,0,function(s){ // menu title text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Settings",0,0);
    });

    settingsMenu.append(false, WIDTH / 2 - 150, 3 * HEIGHT / 16, 300, 30, function(s){   // storm intensity indicator
        let b = simSettings.showStrength ? "Enabled" : "Disabled";
        s.button("Intensity Indicator: "+b,true);
    },function(){
        simSettings.setShowStrength("toggle");
    }).append(false,0,37,300,30,function(s){     // autosaving
        let b = simSettings.doAutosave ? "Enabled" : "Disabled";
        s.button("Autosaving: "+b,true);
    },function(){
        simSettings.setDoAutosave("toggle");
    }).append(false,0,37,300,30,function(s){     // track mode
        let m = ["Active TC Tracks","Full Active Tracks","Season Summary","No Tracks"][simSettings.trackMode];
        s.button("Track Mode: "+m,true);
    },function(){
        simSettings.setTrackMode("incmod",4);
        refreshTracks(true);
    }).append(false,0,37,300,30,function(s){     // snow
        let b = simSettings.snowLayers ? (simSettings.snowLayers*10) + " layers" : "Disabled";
        s.button("Snow: "+b,true);
    },function(){
        simSettings.setSnowLayers("incmod",floor(MAX_SNOW_LAYERS/10)+1);
        if(land) land.clearSnow();
    }).append(false,0,37,300,30,function(s){     // shadows (NOT a shader O~O)
        let b = simSettings.useShadows ? "Enabled" : "Disabled";
        s.button("Land Shadows: "+b,true);
    },function(){
        simSettings.setUseShadows("toggle");
    }).append(false,0,37,300,30,function(s){     // magnifying glass
        let b = simSettings.showMagGlass ? "Enabled" : "Disabled";
        s.button("Magnifying Glass: "+b,true);
    },function(){
        simSettings.setShowMagGlass("toggle");
        if(UI.viewBasin) UI.viewBasin.env.updateMagGlass();
    }).append(false,0,37,300,30,function(s){     // smooth land color
        let b = simSettings.smoothLandColor ? "Enabled" : "Disabled";
        s.button("Smooth Land Color: "+b,true);
    },function(){
        simSettings.setSmoothLandColor("toggle");
        if(land){
            // landBuffer.clear();
            land.drawn = false;
        }
    }).append(false,0,37,300,30,function(s){     // speed unit
        let u = ['kts', 'mph', 'km/h'][simSettings.speedUnit];
        s.button("Windspeed Unit: " + u, true);
    },function(){
        simSettings.setSpeedUnit("incmod", 3);
    }).append(false,0,37,300,30,function(s){     // color scheme
        let n = COLOR_SCHEMES[simSettings.colorScheme].name;
        s.button("Color Scheme: " + n, true);
    },function(){
        simSettings.setColorScheme("incmod", COLOR_SCHEMES.length);
        refreshTracks(true);
    });

    settingsMenu.append(false,WIDTH/2-150,7*HEIGHT/8-20,300,30,function(s){ // "Back" button
        s.button("Back",true,20);
    },function(){
        settingsMenu.hide();
        if(UI.viewBasin instanceof Basin) primaryWrapper.show();
        else mainMenu.show();
    });

    // Are you sure dialog

    areYouSure.append(false,WIDTH/2,HEIGHT/4,0,0,function(s){ // dialog text
        fill(COLORS.UI.text);
        noStroke();
        textAlign(CENTER,CENTER);
        textSize(36);
        text("Are You Sure?",0,0);
        if(areYouSure.desc){
            textSize(24);
            text(areYouSure.desc,0,50);
        }
    });

    areYouSure.append(false,WIDTH/2-108,HEIGHT/4+100,100,30,function(s){ // "Yes" button
        s.button("Yes",true,20);
    },function(){
        if(areYouSure.action){
            areYouSure.action();
            areYouSure.action = undefined;
        }
        else console.error("No action tied to areYouSure dialog");
        areYouSure.hide();
    }).append(false,116,0,100,30,function(s){ // "No" button
        s.button("No",true,20);
    },function(){
        areYouSure.hide();
    });

    areYouSure.dialog = function(action,desc){
        if(action instanceof Function){
            areYouSure.action = action;
            if(typeof desc === "string") areYouSure.desc = desc;
            else areYouSure.desc = undefined;
            areYouSure.show();
        }
    };

    // designation system editor

    const desig_editor_definition = (()=>{
        const section_spacing = 36;
        const section_heights = 28;
        const section_width = 400;
        const name_sections = 6;

        let editing_sub_basin;
        let desig_system;
        let name_list_num = 0;
        let name_list_page = 0;
        let list_lists_mode = true;
        let aux_list = false;
        let prefix_box;
        let suffix_box;
        let num_affix_section;
        let name_editor;
        let name_edit_box;
        let name_edit_index = 0;
        let adding_name = false;

        const refresh_num_section = ()=>{
            if(desig_system instanceof DesignationSystem){
                prefix_box.value = desig_system.numbering.prefix || '';
                suffix_box.value = desig_system.numbering.suffix || '';
            }
            if(desig_system && desig_system.numbering.enabled)
                num_affix_section.show();
            else
                num_affix_section.hide();
        };
        const refresh_name_section = ()=>{
            name_list_page = 0;
        };
        const refresh_desig_editor = ()=>{
            if(editing_sub_basin === undefined)
                editing_sub_basin = UI.viewBasin.mainSubBasin;
            let sb = UI.viewBasin.subBasins[editing_sub_basin];
            if(sb && sb.designationSystem)
                desig_system = sb.designationSystem;
            name_list_num = 0;
            list_lists_mode = true;
            aux_list = false;
            refresh_num_section();
            refresh_name_section();
        };

        const list_array = ()=>{
            if(desig_system instanceof DesignationSystem){
                if(aux_list)
                    return desig_system.naming.auxiliaryLists;
                else
                    return desig_system.naming.mainLists;
            }
        };
        const get_list_from_index = (i)=>{
            let list_arr = list_array();
            if(list_arr)
                return list_arr[i];
        };
        const get_list = ()=>{
            return get_list_from_index(name_list_num);
        };
        const name_at = (i)=>{
            let txt;
            let list = get_list();
            if(list && list[i])
                txt = list[i];
            return txt;
        };
        const invoke_name_editor = (i,is_new_name)=>{
            let list = get_list();
            if(list){
                name_edit_index = i;
                if(is_new_name)
                    name_edit_box.value = '';
                else
                    name_edit_box.value = list[i];
                adding_name = is_new_name;
                name_editor.show();
                name_edit_box.clicked();
            }
        };

        // title text
        desigSystemEditor.append(false,WIDTH/2,HEIGHT/16,0,0,s=>{
            fill(COLORS.UI.text);
            noStroke();
            textAlign(CENTER,CENTER);
            textSize(36);
            text("Designations Editor",0,0);
        });

        // sub-basin selector
        let sb_selector = desigSystemEditor.append(false,WIDTH/2-section_width/2,HEIGHT/8,section_width,0,s=>{
            let txt = 'Editing sub-basin: ';
            let sb = UI.viewBasin.subBasins[editing_sub_basin];
            if(sb instanceof SubBasin)
                txt += sb.getDisplayName();
            textAlign(CENTER,CENTER);
            textSize(18);
            text(txt,section_width/2,section_heights/2);
        });
        
        sb_selector.append(false,0,0,30,10,s=>{ // next sub-basin button
            s.button('',true);
            triangle(15,2,23,8,7,8);
        },()=>{
            do{
                editing_sub_basin++;
                if(editing_sub_basin > 255)
                    editing_sub_basin = 0;
            }while(!(UI.viewBasin.subBasins[editing_sub_basin] instanceof SubBasin && UI.viewBasin.subBasins[editing_sub_basin].designationSystem));
            refresh_desig_editor();
        }).append(false,0,18,30,10,s=>{ // prev sub-basin button
            s.button('',true);
            triangle(15,8,23,2,7,2);
        },()=>{
            do{
                editing_sub_basin--;
                if(editing_sub_basin < 0)
                    editing_sub_basin = 255;
            }while(!(UI.viewBasin.subBasins[editing_sub_basin] instanceof SubBasin && UI.viewBasin.subBasins[editing_sub_basin].designationSystem));
            refresh_desig_editor();
        });

        // numbering enabled/disabled button
        let num_button = sb_selector.append(false,0,section_spacing,section_width,section_heights,s=>{
            let txt = 'Numbering: ';
            let grey = false;
            if(desig_system instanceof DesignationSystem){
                if(desig_system.numbering.enabled)
                    txt += 'Enabled';
                else
                    txt += 'Disabled';
            }
            else{
                txt += 'N/A';
                grey = true;
            }
            s.button(txt,true,18,grey);
        },()=>{
            if(desig_system instanceof DesignationSystem){
                desig_system.numbering.enabled = !desig_system.numbering.enabled;
                refresh_num_section();
            }
        });

        num_affix_section = num_button.append(false,0,section_spacing,0,0);

        // numbering prefix box
        prefix_box = num_affix_section.append(false,0,0,0,0,s=>{
            textAlign(LEFT,CENTER);
            text('Prefix:',0,section_heights/2);
        }).append(false,70,0,section_width/2-75,section_heights,[18,6,()=>{
            if(desig_system instanceof DesignationSystem && desig_system.numbering.enabled)
                desig_system.numbering.prefix = prefix_box.value;
        }]);

        // numbering suffix box
        suffix_box = num_affix_section.append(false,section_width/2+5,0,0,0,s=>{
            textAlign(LEFT,CENTER);
            text('Suffix:',0,section_heights/2);
        }).append(false,70,0,section_width/2-75,section_heights,[18,6,()=>{
            if(desig_system instanceof DesignationSystem && desig_system.numbering.enabled)
                desig_system.numbering.suffix = suffix_box.value;
        }]);

        // name list selector
        let list_selector = num_button.append(false,0,section_spacing*2,section_width,section_heights,s=>{
            let txt;
            if(list_lists_mode)
                txt = aux_list ? `Auxiliary Name Lists` : `Main Name Lists`;
            else
                txt = `Editing name list:${aux_list ? ' Aux.' : ''} List ${name_list_num + 1}`;
            s.button(txt,true,18);
        },()=>{
            if(desig_system instanceof DesignationSystem){
                if(list_lists_mode)
                    aux_list = !aux_list;
                else
                    list_lists_mode = true;
                refresh_name_section();
            }
        });

        const add_name_edit_section = (prev,i)=>{
            const my_width = section_width - 80;
            const index = ()=>name_list_page * name_sections + i;

            let section = prev.append(false,0,section_spacing,my_width,section_heights,s=>{
                let txt = '--';
                let grey = true;
                if(list_lists_mode){
                    let list = get_list_from_index(index());
                    if(list){
                        txt = `${aux_list ? ' Aux.' : ''} List ${index() + 1}`;
                        grey = false;
                    }
                }else{
                    let name = name_at(index());
                    if(name){
                        txt = name;
                        grey = false;
                    }
                }
                s.button(txt,true,18,grey);
            },()=>{
                if(list_lists_mode){
                    let list = get_list_from_index(index());
                    if(list){
                        name_list_num = index();
                        list_lists_mode = false;
                        refresh_name_section();
                    }
                }else{
                    let name = name_at(index());
                    if(name)
                        invoke_name_editor(index(),false);
                }
            });

            section.append(false,my_width+10,0,30,12,s=>{
                let grey = true;
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && index() <= list_arr.length)
                        grey = false;
                }else{
                    let list = get_list();
                    if(list && index() <= list.length)
                        grey = false;
                }
                s.button('+',true,15,grey);
                triangle(25,3,28,10,22,10);
            },()=>{
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && index() <= list_arr.length){
                        list_arr.splice(index(), 0, []);
                        name_list_num = index();
                        list_lists_mode = false;
                    }
                }else{
                    let list = get_list();
                    if(list && index() <= list.length)
                        invoke_name_editor(index(), true);
                }
            }).append(false,0,section_heights-12,30,12,s=>{
                let grey = true;
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && (index() + 1) <= list_arr.length)
                        grey = false;
                }else{
                    let list = get_list();
                    if(list && (index() + 1) <= list.length)
                        grey = false;
                }
                s.button('+',true,15,grey);
                triangle(25,9,28,2,22,2);
            },()=>{
                if(list_lists_mode){
                    let list_arr = list_array();
                    if(list_arr && (index() + 1) <= list_arr.length){
                        list_arr.splice(index() + 1, 0, []);
                        name_list_num = index() + 1;
                        list_lists_mode = false;
                    }
                }else{
                    let list = get_list();
                    if(list && (index() + 1) <= list.length)
                        invoke_name_editor(index() + 1, true);
                }
            });

            section.append(false,my_width+50,0,30,section_heights,s=>{
                let grey;
                if(list_lists_mode)
                    grey = !get_list_from_index(index());
                else
                    grey = !name_at(index());
                s.button('X',true,21,grey);
            },()=>{
                if(list_lists_mode){
                    if(get_list_from_index(index())){
                        let list_arr = list_array();
                        areYouSure.dialog(()=>{
                            list_arr.splice(index(), 1);
                            if(list_arr.length <= name_list_page * name_sections && list_arr.length > 0)
                                name_list_page--;
                        }, `Delete ${aux_list ? 'Aux. ' : ''} List ${index() + 1}?`);
                    }
                }else if(name_at(index())){
                    let list = get_list();
                    list.splice(index(), 1);
                    if(list.length <= name_list_page * name_sections && list.length > 0)
                        name_list_page--;
                }
            });
            return section;
        };

        for(let i = 0, prev = list_selector; i < name_sections; i++){
            prev = add_name_edit_section(prev,i);
        }

        let list_nav = list_selector.append(false,0,section_spacing * (name_sections + 1),0,0);

        list_nav.append(false,section_width/2-40,0,30,section_heights,s=>{
            let grey = true;
            if(name_list_page > 0)
                grey = false;
            s.button('',true,18,grey);
            triangle(4,14,26,4,26,24);
        },()=>{
            if(name_list_page > 0)
                name_list_page--;
        }).append(false,50,0,30,section_heights,s=>{
            let grey = true;
            let list = list_lists_mode ? list_array() : get_list();
            if(list && (name_list_page + 1) * name_sections < list.length)
                grey = false;
            s.button('',true,18,grey);
            triangle(26,14,4,4,4,24);
        },()=>{
            let list = list_lists_mode ? list_array() : get_list();
            if(list && (name_list_page + 1) * name_sections < list.length)
                name_list_page++;
        });

        desigSystemEditor.append(false,WIDTH/2-section_width/2,7*HEIGHT/8+10,section_width,section_heights,function(s){ // "Done" button
            s.button("Done",true,20);
        },function(){
            prefix_box.enterFunc();
            suffix_box.enterFunc();
            editing_sub_basin = UI.viewBasin.mainSubBasin;
            list_lists_mode = true;
            aux_list = false;
            name_list_num = 0;
            name_list_page = 0;
            desigSystemEditor.hide();
            if(UI.viewBasin instanceof Basin)
                primaryWrapper.show();
            else
                mainMenu.show();
        });

        name_editor = desigSystemEditor.append(false,0,0,WIDTH,HEIGHT,s=>{
            fill(COLORS.UI.box);
            noStroke();
            s.fullRect();
        },true,false);

        name_editor.append(false,WIDTH/2,HEIGHT/4,0,0,s=>{
            fill(COLORS.UI.text);
            noStroke();
            textAlign(CENTER,CENTER);
            textSize(24);
            text("Add/Edit Name",0,0);
        });

        name_edit_box = name_editor.append(false, WIDTH/2-section_width/2, HEIGHT/3, section_width, section_heights, [20, 15, ()=>{
            let list = get_list();
            if(list && name_edit_box.value){
                if(adding_name)
                    list.splice(name_edit_index,0,name_edit_box.value);
                else
                    list[name_edit_index] = name_edit_box.value;
            }
            name_editor.hide();
        }]);

        name_edit_box.append(false, 0, section_spacing, section_width, section_heights, s=>{
            s.button('Done',true,20);
        },()=>{
            name_edit_box.enterFunc();
        }).append(false, 0, section_spacing, section_width, section_heights, s=>{
            s.button('Cancel',true,20);
        },()=>{
            name_editor.hide();
        });

        return {refresh: refresh_desig_editor};
    })();

    // primary "in sim" scene

    let topBar = primaryWrapper.append(false,0,0,WIDTH,30,function(s){   // Top bar
        fill(COLORS.UI.bar);
        noStroke();
        s.fullRect();
        textSize(18);
    },false);

    topBar.append(false,5,3,100,24,function(s){  // Date indicator
        if(!(UI.viewBasin instanceof Basin)) return;
        let basin = UI.viewBasin;
        let txtStr = formatDate(basin.tickMoment(viewTick)) + (basin.viewingPresent() ? '' : ' [Analysis]');
        this.setBox(undefined,undefined,textWidth(txtStr)+6);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        text(txtStr,3,3);
    },function(){
        dateNavigator.toggleShow();
    });

    let panel_timeline_container = primaryWrapper.append(false,0,topBar.height,0,0,undefined,undefined,false);

    dateNavigator = primaryWrapper.append(false,0,30,140,80,function(s){     // Analysis navigator panel
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        textSize(15);
        text('Y:',15,53);
    },true,false);

    let navButtonRend = function(s){     // Navigator button render function
        s.button('',false,18,!paused);
        if(this.metadata%2===0) triangle(2,8,10,2,18,8);
        else triangle(2,2,18,2,10,8);
    };

    let navButtonClick = function(){    // Navigator button click function
        if(UI.viewBasin instanceof Basin && paused){
            let basin = UI.viewBasin;
            let m = basin.tickMoment(viewTick);
            switch(this.metadata){
                case 0:
                m.add(TICK_DURATION*ADVISORY_TICKS,"ms");
                break;
                case 1:
                m.subtract(TICK_DURATION*ADVISORY_TICKS,"ms");
                break;
                case 2:
                m.add(1,"M");
                break;
                case 3:
                m.subtract(1,"M");
                break;
                case 4:
                m.add(1,"d");
                break;
                case 5:
                m.subtract(1,"d");
                break;
                case 6:
                m.add(1,"y");
                break;
                case 7:
                m.subtract(1,"y");
                break;
            }
            let t = basin.tickFromMoment(m);
            if(this.metadata%2===0 && t%ADVISORY_TICKS!==0) t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(this.metadata%2!==0 && t%ADVISORY_TICKS!==0) t = ceil(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(t>basin.tick) t = basin.tick;
            if(t<0) t = 0;
            changeViewTick(t);
        }
    };

    for(let i=0;i<8;i++){   // Navigator buttons
        let x = floor(i/2)*30+15;
        let y = i%2===0 ? 10 : 30;
        let button = dateNavigator.append(false,x,y,20,10,navButtonRend,navButtonClick);
        button.metadata = i;
    }

    let dateNavYearInput = dateNavigator.append(false,30,50,70,20,[15,5,function(){
        if(!(UI.viewBasin instanceof Basin)) return;
        let basin = UI.viewBasin;
        let v = this.value;
        let n = parseInt(v);
        if(!Number.isNaN(n) && paused){
            let m = basin.tickMoment(viewTick);
            m.year(n);
            let t = basin.tickFromMoment(m);
            if(t%ADVISORY_TICKS!==0) t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            if(t>basin.tick) t = basin.tick;
            if(t<0) t = 0;
            changeViewTick(t);
            this.value = '';
        }
    }]);

    dateNavYearInput.append(false,80,0,20,20,function(s){
        let v = UI.focusedInput === dateNavYearInput ? /* textInput */UI.inputData.value : dateNavYearInput.value;
        let grey;
        if(Number.isNaN(parseInt(v))) grey = true;
        s.button('',false,15,grey);
        triangle(6,3,17,10,6,17);
        rect(2,8,4,4);
    },function(){
        dateNavYearInput.enterFunc();
    });

    topBar.append(false,WIDTH-29,3,24,24,function(s){    // Toggle button for storm info panel and timeline
        s.button('');
        if(panel_timeline_container.showing) triangle(6,15,18,15,12,9);
        else triangle(6,9,18,9,12,15);
    },function(){
        if(!panel_timeline_container.showing) stormInfoPanel.target = selectedStorm || UI.viewBasin.getSeason(viewTick);
        panel_timeline_container.toggleShow();
    }).append(false,-29,0,24,10,function(s){     // Speed increase
        let grey = simSpeed == MAX_SPEED;
        s.button('', false, undefined, grey);
        triangle(4,2,12,5,4,8);
        triangle(12,2,20,5,12,8);
    },function(){
        if(simSpeed < MAX_SPEED)
            simSpeed++;
    }).append(false,0,14,24,10,function(s){     // Speed decrease
        let grey = simSpeed == MIN_SPEED;
        s.button('', false, undefined, grey);
        triangle(20,2,12,5,20,8);
        triangle(12,2,4,5,12,8);
    },function(){
        if(simSpeed > MIN_SPEED)
            simSpeed--;
    }).append(false,-29,-14,24,24,function(s){  // Pause/resume button
        s.button('');
        if(paused) triangle(3,3,21,12,3,21);
        else{
            rect(5,3,5,18);
            rect(14,3,5,18);
        }
    },function(){
        paused = !paused;
        lastUpdateTimestamp = performance.now();
    }).append(false,-105,0,100,24,function(s){  // Pause/speed/selected storm indicator
        let txtStr = "";
        if(selectedStorm){
            let sName = selectedStorm.getFullNameByTick(viewTick);
            let sData = selectedStorm.getStormDataByTick(viewTick);
            if(sData){
                let sWind = sData ? sData.windSpeed : 0;
                sWind = displayWindspeed(sWind);
                let sPrsr = sData ? sData.pressure: 1031;
                txtStr = `${sName}: ${sWind} / ${sPrsr} hPa`;
            }else{
                sName = selectedStorm.getFullNameByTick("peak");
                txtStr = sName + " - ACE: " + selectedStorm.ACE;
            }
        }else{
            if(paused)
                txtStr = "Paused";
            else if(simSpeed < -1)
                txtStr = `1/${Math.pow(2, -simSpeed)} Speed`;
            else if(simSpeed === -1)
                txtStr = 'Half-Speed';
            else if(simSpeed === 0)
                txtStr = 'Normal-Speed';
            else if(simSpeed === 1)
                txtStr = 'Double-Speed';
            else
                txtStr = `${Math.pow(2, simSpeed)}x Speed`;
        }
        let newW = textWidth(txtStr)+6;
        this.setBox(-newW-5,undefined,newW);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        fill(COLORS.UI.text);
        textAlign(RIGHT,TOP);
        text(txtStr,this.width-3,3);
    },function(){
        if(!selectedStorm){
            paused = !paused;
            lastUpdateTimestamp = performance.now();
        }else{
            stormInfoPanel.target = selectedStorm;
            panel_timeline_container.show();
        }
    });

    let bottomBar = primaryWrapper.append(false,0,HEIGHT-30,WIDTH,30,function(s){    // Bottom bar
        fill(COLORS.UI.bar);
        noStroke();
        s.fullRect();
        textSize(18);
    },false);

    bottomBar.append(false,5,3,24,24,function(s){    // Side menu button
        s.button('');
        rect(3,6,18,2);
        rect(3,11,18,2);
        rect(3,16,18,2);
    },function(){
        sideMenu.toggleShow();
        saveBasinAsPanel.hide();
    }).append(false,29,0,100,24,function(s){   // Map layer/environmental field indicator
        let basin = UI.viewBasin;
        let txtStr = "Map Layer: ";
        let red = false;
        if(basin.env.displaying!==-1){
            let f = basin.env.fieldList[basin.env.displaying];
            txtStr += basin.env.getDisplayName(f) + " -- ";
            let x;
            let y;
            let S = selectedStorm && selectedStorm.aliveAt(viewTick);
            if(S){
                let p = selectedStorm.getStormDataByTick(viewTick,true).pos;
                x = p.x;
                y = p.y;
            }else{
                x = getMouseX();
                y = getMouseY();
            }
            if(x >= WIDTH || x < 0 || y >= HEIGHT || y < 0 || (basin.env.fields[f].oceanic && land.get(Coordinate.convertFromXY(basin.mapType, x, y)))){
                txtStr += "N/A";
            }else{
                let v = basin.env.get(f,x,y,viewTick);
                if(v===null){
                    txtStr += "Unavailable";
                    red = true;
                }else
                    txtStr += basin.env.formatFieldValue(f,v);
            }
            txtStr += " @ " + (S ? "selected storm" : "pointer");
            if(viewTick<=basin.env.fields[f].accurateAfter){
                txtStr += ' [MAY BE INACCURATE]';
                red = true;
            }
        }else txtStr += "none";
        this.setBox(undefined,undefined,textWidth(txtStr)+6);
        if(this.isHovered()){
            fill(COLORS.UI.buttonHover);
            s.fullRect();
        }
        if(red) fill('red');
        else fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        text(txtStr,3,3);
    },function(){
        UI.viewBasin.env.displayNext();
    });

    bottomBar.append(false,WIDTH-29,3,24,24,function(s){    // Fullscreen button
        s.button('',false);
        stroke(0);
        if(document.fullscreenElement===canvas){
            line(9,4,9,9);
            line(4,9,9,9);
            line(15,4,15,9);
            line(20,9,15,9);
            line(9,20,9,15);
            line(4,15,9,15);
            line(15,20,15,15);
            line(20,15,15,15);
        }else{
            line(4,4,4,9);
            line(4,4,9,4);
            line(20,4,20,9);
            line(20,4,15,4);
            line(4,20,4,15);
            line(4,20,9,20);
            line(20,20,20,15);
            line(20,20,15,20);
        }
    },function(){
        toggleFullscreen();
    }).append(false,-29,0,24,24,function(s){  // Help button
        noStroke();
        s.button("?",false,22);
    },function(){
        helpBox.toggleShow();
    });

    let timeline;
    let season_button;

    const INFO_PANEL_LEFT_BOUND = 11*WIDTH/16;

    stormInfoPanel = panel_timeline_container.append(false, INFO_PANEL_LEFT_BOUND, 0, WIDTH-INFO_PANEL_LEFT_BOUND, HEIGHT-topBar.height-bottomBar.height, function(s){
        let S = this.target;
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        const txt_width = 7*this.width/8;
        const left_col_width = 7*txt_width/16;
        const right_col_width = 9*txt_width/16;
        let name;
        let txt_y = 35;
        let info_row = (left, right)=>{
            left = wrapText('' + left, left_col_width);
            right = wrapText('' + right, right_col_width);
            textAlign(LEFT, TOP);
            text(left, this.width/16, txt_y);
            textAlign(RIGHT, TOP);
            text(right, 15*this.width/16, txt_y);
            txt_y += max(countTextLines(left) * textLeading(), countTextLines(right) * textLeading()) + 3;
        };
        if(S instanceof Storm){
            season_button.show();
            name = S.getFullNameByTick("peak");
            name = wrapText(name, txt_width);
            text(name, this.width/2, txt_y);
            txt_y += countTextLines(name)*textLeading();
            textSize(15);
            let right_txt = '';
            if(S.inBasinTC){
                let enterTime = formatDate(UI.viewBasin.tickMoment(S.enterTime));
                let exitTime = formatDate(UI.viewBasin.tickMoment(S.exitTime));
                right_txt += enterTime;
                if(S.enterTime > S.formationTime)
                    right_txt += ' (entered basin)';
                right_txt += ' -\n';
                if(S.exitTime){
                    right_txt += exitTime;
                    if(!S.dissipationTime || S.exitTime < S.dissipationTime)
                        right_txt += ' (left basin)';
                }else
                    right_txt += 'currently active';
            }else if(S.TC){
                let formTime = formatDate(UI.viewBasin.tickMoment(S.formationTime));
                let dissTime = formatDate(UI.viewBasin.tickMoment(S.dissipationTime));
                right_txt += formTime + ' -\n';
                if(S.dissipationTime)
                    right_txt += dissTime;
                else
                    right_txt += 'currently active';
            }else
                right_txt += "N/A";
            info_row('Dates active', right_txt);
            if(S.peak)
                info_row('Peak pressure', S.peak.pressure + ' hPa');
            else
                info_row('Peak pressure', 'N/A');
            if(S.windPeak)
                info_row('Peak wind speed', displayWindspeed(S.windPeak.windSpeed));
            else
                info_row('Peak wind speed', 'N/A');
            info_row('ACE', S.ACE);
            info_row('Damage', damageDisplayNumber(S.damage));
            info_row('Deaths', S.deaths);
            info_row('Landfalls', S.landfalls);
        }else{
            name = seasonName(S);
            name = wrapText(name, txt_width);
            text(name, this.width/2, txt_y);
            txt_y += countTextLines(name)*textLeading();
            textSize(15);
            let se = UI.viewBasin.fetchSeason(S);
            if(se instanceof Season){
                let stats = se.stats(UI.viewBasin.mainSubBasin);
                let counters = stats.classificationCounters;
                let scale = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin);
                for(let {statName, cNumber} of scale.statDisplay())
                    info_row(statName, counters[cNumber]);
                info_row('Total ACE', stats.ACE);
                info_row('Damage', damageDisplayNumber(stats.damage));
                info_row('Deaths', stats.deaths);
                info_row('Landfalls', stats.landfalls);
                if(stats.most_intense){
                    let most_intense = stats.most_intense.fetch();
                    info_row('Most Intense', most_intense.getNameByTick(-1) + '\n' + most_intense.peak.pressure + ' hPa\n' + displayWindspeed(most_intense.windPeak.windSpeed));
                }else
                    info_row('Most Intense', 'N/A');
            }else
                text('Season Data Unavailable', this.width/2, txt_y);
        }
    },true);

    let timeline_container = panel_timeline_container.append(false,0,0,0,0);

    function find_next_storm(storm,prev){
        if(storm instanceof Storm){
            let season = storm.basin.fetchSeason(storm.statisticalSeason());
            if(season instanceof Season){
                let recent;
                let found_me;
                for(let s of season.forSystems()){
                    if(s instanceof Storm){
                        if(s === storm){
                            if(prev)
                                return recent;
                            else
                                found_me = true;
                        }else if(s.inBasinTC){
                            if(prev)
                                recent = s;
                            else if(found_me)
                                return s;
                        }
                    }
                }
            }
        }
    }

    panel_timeline_container.append(false,INFO_PANEL_LEFT_BOUND+3,3,24,24,function(s){   // info panel/timeline previous storm/season button
        if(timeline.active())
            this.setBox(WIDTH*0.05,5,24,24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+3,3,24,24);
        let S = stormInfoPanel.target;
        let grey;
        if(S instanceof Storm)
            grey = !find_next_storm(S,true);
        else
            grey = S<=UI.viewBasin.getSeason(0);
        s.button('',false,18,grey);
        triangle(19,5,19,19,5,12);
    },function(){
        let s = stormInfoPanel.target;
        if(s instanceof Storm){
            let n = find_next_storm(s,true);
            if(n)
                stormInfoPanel.target = n;
        }else if(s>UI.viewBasin.getSeason(0))
            stormInfoPanel.target--;
    });
    
    panel_timeline_container.append(false,WIDTH-27,3,24,24,function(s){ // info panel/timeline next storm/season button
        if(timeline.active())
            this.setBox(WIDTH*0.95-24,5,24,24);
        else
            this.setBox(WIDTH-27,3,24,24);
        let S = stormInfoPanel.target;
        let grey;
        if(S instanceof Storm)
            grey = !find_next_storm(S);
        else
            grey = S>=UI.viewBasin.getSeason(-1);
        s.button('',false,18,grey);
        triangle(5,5,5,19,19,12);
    },function(){
        let s = stormInfoPanel.target;
        if(s instanceof Storm){
            let n = find_next_storm(s);
            if(n)
                stormInfoPanel.target = n;
        }else if(s<UI.viewBasin.getSeason(-1))
            stormInfoPanel.target++;
    });

    season_button = panel_timeline_container.append(false, INFO_PANEL_LEFT_BOUND+30, 3, stormInfoPanel.width-60, 24, function(s){ // Season button
        if(timeline.active())
            this.setBox(5*WIDTH/12, 32, WIDTH/6, 24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+30, 3, stormInfoPanel.width-60, 24);
        let t = stormInfoPanel.target;
        if(t instanceof Storm)
            s.button(seasonName(t.statisticalSeason()),false,15);
        else
            this.hide();
    },function(){
        let t = stormInfoPanel.target;
        if(t instanceof Storm)
            stormInfoPanel.target = t.statisticalSeason();
    });
    
    panel_timeline_container.append(false,INFO_PANEL_LEFT_BOUND+30,stormInfoPanel.height-54,stormInfoPanel.width-60,24,function(s){ // info panel "Jump to" button
        if(timeline.active())
            this.setBox(WIDTH*0.95 - WIDTH/6, 32, WIDTH/6, 24);
        else
            this.setBox(INFO_PANEL_LEFT_BOUND+30,stormInfoPanel.height-54,stormInfoPanel.width-60,24);
        s.button("Jump to",false,15,!paused || stormInfoPanel.target===undefined);
    },function(){
        if(paused && stormInfoPanel.target!==undefined){
            let s = stormInfoPanel.target;
            let t;
            if(s instanceof Storm){
                if(s.enterTime) t = s.enterTime;
                else if(s.formationTime) t = s.formationTime;
                else t = s.birthTime;
                t = ceil(t/ADVISORY_TICKS)*ADVISORY_TICKS;
            }else{
                t = UI.viewBasin.seasonTick(s);
            }
            changeViewTick(t);
        }
    });
    
    stormInfoPanel.append(false,30,stormInfoPanel.height-27,stormInfoPanel.width-60,24,function(s){ // show season summary timeline button
        s.button("View Timeline",false,15);
    },function(){
        timeline.view();
    });

    timeline = (function(){
        const BOX_WIDTH = WIDTH;
        const BOX_HEIGHT = (HEIGHT-topBar.height-bottomBar.height)*2/3;
        let months = 12;
        let sMonth = 0;
        let parts = [];
        let builtAt;
        let builtFor;
        let active = false;

        function build(){
            parts = [];
            let plotWidth = BOX_WIDTH*0.9;
            let target = stormInfoPanel.target;
            if(target!==undefined && !(target instanceof Storm)){
                let gen = s=>{
                    let TCs = [];
                    let beginSeasonTick;
                    let endSeasonTick;
                    for(let sys of s.forSystems()){
                        if(sys.inBasinTC && (UI.viewBasin.getSeason(sys.enterTime)===target || UI.viewBasin.getSeason(sys.enterTime)<target && (sys.exitTime===undefined || UI.viewBasin.getSeason(sys.exitTime-1)>=target))){
                            TCs.push(sys);
                            let dissTime = sys.exitTime || UI.viewBasin.tick;
                            if(beginSeasonTick===undefined || sys.enterTime<beginSeasonTick) beginSeasonTick = sys.enterTime;
                            if(endSeasonTick===undefined || dissTime>endSeasonTick) endSeasonTick = dissTime;
                        }
                    }
                    for(let n=0;n<TCs.length-1;n++){
                        let t0 = TCs[n];
                        let t1 = TCs[n+1];
                        if(t0.enterTime>t1.enterTime){
                            TCs[n] = t1;
                            TCs[n+1] = t0;
                            if(n>0) n -= 2;
                        }
                    }
                    let sMoment = UI.viewBasin.tickMoment(beginSeasonTick);
                    sMonth = sMoment.month();
                    sMoment.startOf('month');
                    let beginPlotTick = UI.viewBasin.tickFromMoment(sMoment);
                    let eMoment = UI.viewBasin.tickMoment(endSeasonTick);
                    eMoment.endOf('month');
                    let endPlotTick = UI.viewBasin.tickFromMoment(eMoment);
                    months = eMoment.diff(sMoment,'months') + 1;
                    for(let t of TCs){
                        let part = {};
                        part.storm = t;
                        part.segments = [];
                        part.label = t.getNameByTick(-2);
                        let aSegment;
                        for(let q=0;q<t.record.length;q++){
                            let rt = ceil(t.birthTime/ADVISORY_TICKS)*ADVISORY_TICKS + q*ADVISORY_TICKS;
                            let d = t.record[q];
                            if(tropOrSub(d.type)&&land.inBasin(d.coord())){
                                let clsn = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin).get(d);
                                if(!aSegment){
                                    aSegment = {};
                                    part.segments.push(aSegment);
                                    aSegment.startTick = rt;
                                    aSegment.maxCat = clsn;
                                    aSegment.fullyTrop = (d.type===TROP);
                                }
                                if(clsn > aSegment.maxCat) aSegment.maxCat = clsn;
                                aSegment.fullyTrop = aSegment.fullyTrop || (d.type===TROP);
                                aSegment.endTick = rt;
                            }else if(aSegment) aSegment = undefined;
                        }
                        for(let q=0;q<part.segments.length;q++){
                            let seg = part.segments[q];
                            seg.startX = map(seg.startTick,beginPlotTick,endPlotTick,0,plotWidth);
                            seg.endX = map(seg.endTick,beginPlotTick,endPlotTick,0,plotWidth);
                        }
                        let rowFits;
                        part.row = -1;
                        textSize(12);
                        let thisLabelZone = textWidth(part.label) + 6;
                        do{
                            part.row++;
                            rowFits = true;
                            for(let q=0;q<parts.length;q++){
                                let p = parts[q];
                                let otherLabelZone = textWidth(p.label) + 6;
                                let thisS = part.segments[0].startX;
                                let thisE = part.segments[part.segments.length-1].endX + thisLabelZone;
                                let otherS = p.segments[0].startX;
                                let otherE = p.segments[p.segments.length-1].endX + otherLabelZone;
                                if(p.row===part.row){
                                    if(thisS>=otherS && thisS<=otherE ||
                                        thisE>=otherS && thisE<=otherE ||
                                        otherS>=thisS && otherS<=thisE ||
                                        otherE>=thisS && otherE<=thisE) rowFits = false;
                                }
                            }
                        }while(!rowFits);
                        parts.push(part);
                    }
                };
                if(UI.viewBasin.fetchSeason(target)) gen(UI.viewBasin.fetchSeason(target));
                else{
                    months = 12;
                    sMonth = 0;
                    UI.viewBasin.fetchSeason(target,false,false,s=>{
                        gen(s);
                    });
                }
            }else{
                months = 12;
                sMonth = 0;
            }
            builtFor = target;
            builtAt = UI.viewBasin.tick;
        }

        const lBound = BOX_WIDTH*0.05;
        const rBound = BOX_WIDTH*0.95;
        const tBound = BOX_HEIGHT*0.2;
        const bBound = BOX_HEIGHT*0.93;
        const maxRowFit = Math.floor((bBound-tBound)/15);

        let timelineBox = timeline_container.append(false,0,0,BOX_WIDTH,BOX_HEIGHT,function(s){
            let target = stormInfoPanel.target;
            if(target!==builtFor || (UI.viewBasin.tick!==builtAt && (UI.viewBasin.getSeason(builtAt)===target || UI.viewBasin.getSeason(builtAt)===(target+1)))) build();
            fill(COLORS.UI.box);
            noStroke();
            s.fullRect();
            fill(COLORS.UI.text);
            textAlign(CENTER,TOP);
            textSize(18);
            if(target === undefined)
                text('No timeline selected', BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
            else if(target instanceof Storm){
                text('Intensity graph of ' + target.getFullNameByTick('peak'), BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
                season_button.show();
                let begin_tick = target.enterTime;
                let end_tick = target.exitTime || UI.viewBasin.tick;
                let max_wind;
                for(let t = begin_tick; t <= end_tick; t += ADVISORY_TICKS){
                    if(target.getStormDataByTick(t)){
                        let w = target.getStormDataByTick(t).windSpeed;
                        if(max_wind === undefined || w > max_wind)
                            max_wind = w;
                    }
                }
                let scale = UI.viewBasin.getScale(UI.viewBasin.mainSubBasin);
                if(scale.measure === SCALE_MEASURE_ONE_MIN_KNOTS || scale.measure === SCALE_MEASURE_TEN_MIN_KNOTS){
                    let color = scale.getColor(0);
                    let y0 = bBound;
                    for(let i = 1; i < scale.classifications.length; i++){
                        let threshold = scale.classifications[i].threshold;
                        let y1 = map(threshold, 0, max_wind, bBound, tBound, true);
                        fill(red(color), green(color), blue(color), 90);
                        rect(lBound, y1, rBound - lBound, y0 - y1);
                        color = scale.getColor(i);
                        y0 = y1;
                        if(threshold > max_wind)
                            break;
                        if(i === scale.classifications.length - 1 && threshold < max_wind){
                            fill(red(color), green(color), blue(color), 90);
                            rect(lBound, tBound, rBound - lBound, y0 - tBound);
                        }
                    }
                }
                stroke(COLORS.UI.text);
                line(lBound,bBound,rBound,bBound);
                line(rBound,bBound,rBound,tBound);
                textSize(13);
                fill(COLORS.UI.text);
                for(let m = UI.viewBasin.tickMoment(begin_tick).startOf('day'); UI.viewBasin.tickFromMoment(m) <= end_tick; m.add(1, 'd')){
                    stroke(COLORS.UI.text);
                    let x = map(UI.viewBasin.tickFromMoment(m), begin_tick, end_tick, lBound, rBound, true);
                    line(x, bBound, x, tBound);
                    noStroke();
                    text(m.date(), x, bBound + BOX_HEIGHT * 0.02);
                }
                textAlign(RIGHT, CENTER);
                let y_axis_inc = ceil((max_wind / 10) / 5) * 5;
                for(let i = 0; i <= max_wind; i += y_axis_inc){
                    stroke(COLORS.UI.text);
                    let y = map(i, 0, max_wind, bBound, tBound);
                    line(lBound - BOX_WIDTH * 0.008, y, lBound, y);
                    noStroke();
                    let unitLocalizedWind = [i, ktsToMph(i, WINDSPEED_ROUNDING), ktsToKmh(i, WINDSPEED_ROUNDING)][simSettings.speedUnit];
                    text(unitLocalizedWind, lBound - BOX_WIDTH * 0.01, y);
                }
                for(let t0 = begin_tick, t1 = t0 + ADVISORY_TICKS; t1 <= end_tick; t0 = t1, t1 += ADVISORY_TICKS){
                    let w0 = target.getStormDataByTick(t0).windSpeed;
                    let w1;
                    if(target.getStormDataByTick(t1))
                        w1 = target.getStormDataByTick(t1).windSpeed;
                    else
                        w1 = w0;
                    let x0 = map(t0, begin_tick, end_tick, lBound, rBound);
                    let y0 = map(w0, 0, max_wind, bBound, tBound);
                    let x1 = map(t1, begin_tick, end_tick, lBound, rBound);
                    let y1 = map(w1, 0, max_wind, bBound, tBound);
                    if(tropOrSub(target.getStormDataByTick(t0).type))
                        stroke(COLORS.UI.text);
                    else
                        stroke('#CCC');
                    strokeWeight(5);
                    point(x0, y0);
                    strokeWeight(2);
                    line(x0, y0, x1, y1);
                }
                strokeWeight(1);
            }else{
                text('Timeline of ' + seasonName(target), BOX_WIDTH * 0.5, BOX_HEIGHT * 0.03);
                stroke(COLORS.UI.text);
                line(lBound,bBound,rBound,bBound);
                line(lBound,bBound,lBound,tBound);
                textSize(13);
                let M = ['J','F','M','A','M','J','J','A','S','O','N','D'];
                for(let i=0;i<months;i++){
                    stroke(COLORS.UI.text);
                    let x0 = map(i+1,0,months,lBound,rBound);
                    let x1 = map(i+0.5,0,months,lBound,rBound);
                    line(x0,bBound,x0,tBound);
                    noStroke();
                    text(M[(i+sMonth)%12],x1,bBound+BOX_HEIGHT*0.02);
                }
                noStroke();
                for(let i=0;i<parts.length;i++){
                    let p = parts[i];
                    let y = tBound+(p.row % maxRowFit)*15;
                    let mx = getMouseX()-this.getX();
                    let my = getMouseY()-this.getY();
                    textSize(12);
                    if(mx>=lBound+p.segments[0].startX && mx<lBound+p.segments[p.segments.length-1].endX+textWidth(p.label)+6 && my>=y && my<y+10) stroke(255);
                    else noStroke();
                    for(let j=0;j<p.segments.length;j++){
                        let S = p.segments[j];
                        fill(UI.viewBasin.getScale(UI.viewBasin.mainSubBasin).getColor(S.maxCat,!S.fullyTrop));
                        rect(lBound+S.startX,y,max(S.endX-S.startX,1),10);
                    }
                    let labelLeftBound = lBound + p.segments[p.segments.length-1].endX;
                    fill(COLORS.UI.text);
                    textAlign(LEFT,CENTER);
                    text(p.label,labelLeftBound+3,y+5);
                }
            }
        },function(){
            let newTarget;
            for(let i=parts.length-1;i>=0;i--){
                let p = parts[i];
                let y = tBound+(p.row % maxRowFit)*15;
                let mx = getMouseX()-this.getX();
                let my = getMouseY()-this.getY();
                textSize(12);
                if(mx>=lBound+p.segments[0].startX && mx<lBound+p.segments[p.segments.length-1].endX+textWidth(p.label)+6 && my>=y && my<y+10){
                    newTarget = p.storm;
                    break;
                }
            }
            if(newTarget) stormInfoPanel.target = newTarget;
        },false);

        timelineBox.append(false,timelineBox.width-27,0,27,timelineBox.height,function(s){
            s.button('',false,18);
            triangle(11,timelineBox.height/2-6,11,timelineBox.height/2+6,16,timelineBox.height/2);
        },function(){
            timelineBox.hide();
            stormInfoPanel.show();
            active = false;
        });

        const public = {};

        public.active = function(){
            return active;
        };

        public.view = function(){
            stormInfoPanel.hide();
            timelineBox.show();
            active = true;
        };

        public.reset = function(){
            active = false;
            builtAt = -1;
        };

        return public;
    })();
    
    let returntomainmenu = function(p){
        sideMenu.hide();
        panel_timeline_container.hide();
        timeline.reset();
        primaryWrapper.hide();
        land.clear();
        for(let t in UI.viewBasin.seasonExpirationTimers) clearTimeout(UI.viewBasin.seasonExpirationTimers[t]);
        for(let s in UI.viewBasin.subBasins){
            let sb = UI.viewBasin.subBasins[s];
            if(sb instanceof SubBasin && sb.mapOutline) sb.mapOutline.remove();
        }
        let wait = ()=>{
            UI.viewBasin = undefined;
            mainMenu.show();
        };
        if(p instanceof Promise) p.then(wait);
        else wait();
    };

    sideMenu = primaryWrapper.append(false,0,topBar.height,WIDTH/4,HEIGHT-topBar.height-bottomBar.height,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        text("Menu",this.width/2,10);
    },true,false);

    sideMenu.append(false,5,30,sideMenu.width-10,25,function(s){ // Save and return to main menu button
        s.button("Save and Return to Main Menu",false,15);
    },function(){
        if(UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME) saveBasinAsPanel.invoke(true);
        else{
            returntomainmenu(UI.viewBasin.save());
        }
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Return to main menu w/o saving button
        s.button("Return to Main Menu w/o Saving",false,15);
    },function(){
        areYouSure.dialog(returntomainmenu);
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Save basin button
        let txt = "Save Basin";
        if(UI.viewBasin.tick===UI.viewBasin.lastSaved) txt += " [Saved]";
        s.button(txt,false,15);
    },function(){
        if(UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME) saveBasinAsPanel.invoke();
        else UI.viewBasin.save();
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Save basin as button
        s.button("Save Basin As...",false,15);
    },function(){
        saveBasinAsPanel.invoke();
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Settings menu button
        s.button("Settings",false,15);
    },function(){
        primaryWrapper.hide();
        settingsMenu.show();
        paused = true;
    }).append(false,0,30,sideMenu.width-10,25,function(s){   // Designation system editor menu button
        s.button("Edit Designations",false,15);
    },function(){
        desig_editor_definition.refresh();
        primaryWrapper.hide();
        desigSystemEditor.show();
        paused = true;
    }).append(false,0,30,sideMenu.width-10,25,function(s){  // Basin seed button
        s.button('Basin Seed',false,15);
    },function(){
        seedBox.toggleShow();
        if(seedBox.showing) seedBox.clicked();
    });

    saveBasinAsPanel = sideMenu.append(false,sideMenu.width,0,sideMenu.width*3/4,100,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(CENTER,TOP);
        textSize(18);
        text("Save Basin As...",this.width/2,10);
        stroke(0);
        line(0,0,0,this.height);
    },true,false);

    let saveBasinAsTextBox = saveBasinAsPanel.append(false,5,40,saveBasinAsPanel.width-10,25,[15,32,function(){
        let n = this.value;
        if(n!=='' && n!==AUTOSAVE_SAVE_NAME){
            if(n===UI.viewBasin.saveName){
                UI.viewBasin.save();
                saveBasinAsPanel.hide();
            }else{
                let f = ()=>{
                    let p = UI.viewBasin.saveAs(n);
                    saveBasinAsPanel.hide();
                    if(saveBasinAsPanel.exit) returntomainmenu(p);
                };
                db.saves.where(':id').equals(n).count().then(c=>{
                    if(c>0) areYouSure.dialog(f,'Overwrite "'+n+'"?');
                    else f();
                });
            }
        }
    }]);

    saveBasinAsTextBox.append(false,0,30,saveBasinAsPanel.width-10,25,function(s){
        let n = UI.focusedInput===saveBasinAsTextBox ? /* textInput */UI.inputData.value : saveBasinAsTextBox.value;
        let grey = n==='' || n===AUTOSAVE_SAVE_NAME;
        s.button('Ok',false,15,grey);
    },function(){
        saveBasinAsTextBox.enterFunc();
    });

    saveBasinAsPanel.invoke = function(exit){
        saveBasinAsPanel.exit = exit;
        saveBasinAsPanel.toggleShow();
        saveBasinAsTextBox.value = UI.viewBasin.saveName===AUTOSAVE_SAVE_NAME ? '' : UI.viewBasin.saveName;
    };

    seedBox = primaryWrapper.append(false,WIDTH/2-100,HEIGHT/2-15,200,30,[18,undefined,function(){  // textbox for copying the basin seed
        this.value = UI.viewBasin.seed.toString();
    }],function(){
        /* textInput */UI.inputData.value = this.value = UI.viewBasin.seed.toString();
        // textInput.setSelectionRange(0,textInput.value.length);
        UI.inputData.selectionStart = 0;
        UI.inputData.selectionEnd = UI.inputData.value.length;
    },false);

    helpBox = primaryWrapper.append(false,WIDTH/8,HEIGHT/8,3*WIDTH/4,3*HEIGHT/4,function(s){
        fill(COLORS.UI.box);
        noStroke();
        s.fullRect();
        fill(COLORS.UI.text);
        textAlign(LEFT,TOP);
        textSize(15);
        text(HELP_TEXT,10,10);
    },true,false);

    helpBox.append(false,helpBox.width-30,10,20,20,function(s){
        s.button("X",false,22);
    },function(){
        helpBox.hide();
    });
};

function mouseInCanvas(){
    return coordinateInCanvas(getMouseX(),getMouseY());
}

function mouseClicked(){
    if(mouseInCanvas() && waitingFor<1){
        UI.click();
        return false;
    }
}

function selectStorm(s){
    if(s instanceof Storm){
        selectedStorm = s;
        stormInfoPanel.target = s;
    }else selectedStorm = undefined;
}

function keyPressed(){
    // console.log("keyPressed: " + key + " / " + keyCode);
    const k = key.toLowerCase();
    keyRepeatFrameCounter = -1;
    if(/* document.activeElement === textInput */ UI.focusedInput){
        switch(keyCode){
            case ESCAPE:
                // textInput.value = UI.focusedInput.value;
                // textInput.blur();
                UI.focusedInput = undefined;
                break;
            case ENTER:
                let u = UI.focusedInput;
                // textInput.blur();
                u.value = UI.inputData.value;
                UI.focusedInput = undefined;
                if(u.enterFunc) u.enterFunc();
                break;
            case UP_ARROW:
                UI.setInputCursorPosition(0, keyIsDown(SHIFT));
                break;
            case DOWN_ARROW:
                UI.setInputCursorPosition(UI.inputData.value.length, keyIsDown(SHIFT));
                break;
            // these are handled by keyRepeat(); break then return false so evt.preventDefault() is called
            case LEFT_ARROW:
            case RIGHT_ARROW:
            case BACKSPACE:
            case DELETE:
                break;
            default:
                if(keyIsDown(CONTROL)){
                    switch(k){
                        case 'x':
                            if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                                navigator.clipboard.writeText(UI.inputData.value.slice(UI.inputData.selectionStart, UI.inputData.selectionEnd));
                                UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                                UI.setInputCursorPosition(UI.inputData.selectionStart);
                            }
                            break;
                        case 'c':
                            if(UI.inputData.selectionStart !== UI.inputData.selectionEnd)
                                navigator.clipboard.writeText(UI.inputData.value.slice(UI.inputData.selectionStart, UI.inputData.selectionEnd));
                            break;
                        case 'v':
                            navigator.clipboard.readText().then(v => {
                                if(!UI.inputData.maxLength || UI.inputData.value.length + v.length - (UI.inputData.selectionEnd - UI.inputData.selectionStart) <= UI.inputData.maxLength){
                                    UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + v + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                                    UI.setInputCursorPosition(UI.inputData.selectionStart + v.length);
                                }
                            });
                            break;
                        default:
                            return;
                    }
                }
                return;
        }
    }else{
        switch(k){
            case " ":
                if(UI.viewBasin && primaryWrapper.showing){
                    paused = !paused;
                    lastUpdateTimestamp = performance.now();
                }
                break;
            case "a":
                if(UI.viewBasin && paused && primaryWrapper.showing) UI.viewBasin.advanceSim();
                break;
            case "w":
                simSettings.setShowStrength("toggle");
                break;
            case "e":
                if(UI.viewBasin) UI.viewBasin.env.displayNext();
                break;
            case "t":
                simSettings.setTrackMode("incmod",4);
                refreshTracks(true);
                break;
            case "m":
                simSettings.setShowMagGlass("toggle");
                if(UI.viewBasin) UI.viewBasin.env.updateMagGlass();
                break;
            case 'u':
                simSettings.setSpeedUnit("incmod", 3);
                break;
            case 'c':
                simSettings.setColorScheme("incmod", COLOR_SCHEMES.length);
                refreshTracks(true);
                break;
            default:
                switch(keyCode){
                    case KEY_LEFT_BRACKET:
                    if(simSpeed > MIN_SPEED)
                        simSpeed--;
                    break;
                    case KEY_RIGHT_BRACKET:
                    if(simSpeed < MAX_SPEED)
                        simSpeed++;
                    break;
                    case KEY_F11:
                    toggleFullscreen();
                    break;
                    default:
                    return;
                }
        }
    }
    return false;
}

function keyRepeat(){
    if(UI.focusedInput){
        switch(keyCode){
            case LEFT_ARROW:
                if(keyIsDown(LEFT_ARROW)){
                    let i;
                    if(keyIsDown(CONTROL))
                        i = UI.inputData.value.lastIndexOf(' ', UI.inputData.cursor - 2) + 1;
                    else if(UI.inputData.selectionStart !== UI.inputData.selectionEnd && !keyIsDown(SHIFT))
                        i = UI.inputData.selectionStart;
                    else
                        i = UI.inputData.cursor - 1;
                    UI.setInputCursorPosition(Math.max(0, i), keyIsDown(SHIFT));
                }
                break;
            case RIGHT_ARROW:
                if(keyIsDown(RIGHT_ARROW)){
                    let i;
                    if(keyIsDown(CONTROL)){
                        i = UI.inputData.value.indexOf(' ', UI.inputData.cursor + 1);
                        if(i === -1)
                            i = UI.inputData.value.length;
                    }else if(UI.inputData.selectionStart !== UI.inputData.selectionEnd && !keyIsDown(SHIFT))
                        i = UI.inputData.selectionEnd;
                    else
                        i = UI.inputData.cursor + 1;
                    UI.setInputCursorPosition(Math.min(UI.inputData.value.length, i), keyIsDown(SHIFT));
                }
                break;
            case BACKSPACE:
                if(keyIsDown(BACKSPACE)){
                    if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.selectionStart);
                    }else if(UI.inputData.cursor > 0){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.cursor - 1) + UI.inputData.value.slice(UI.inputData.cursor, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.cursor - 1);
                    }
                }
                break;
            case DELETE:
                if(keyIsDown(DELETE)){
                    if(UI.inputData.selectionStart !== UI.inputData.selectionEnd){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                        UI.setInputCursorPosition(UI.inputData.selectionStart);
                    }else if(UI.inputData.cursor < UI.inputData.value.length){
                        UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.cursor) + UI.inputData.value.slice(UI.inputData.cursor + 1, UI.inputData.value.length);
                    }
                }
                break;
            default:
                if(UI.inputData.insert && (!UI.inputData.maxLength || UI.inputData.value.length + UI.inputData.insert.length - (UI.inputData.selectionEnd - UI.inputData.selectionStart) <= UI.inputData.maxLength)){
                    UI.inputData.value = UI.inputData.value.slice(0, UI.inputData.selectionStart) + UI.inputData.insert + UI.inputData.value.slice(UI.inputData.selectionEnd, UI.inputData.value.length);
                    UI.setInputCursorPosition(UI.inputData.selectionStart + UI.inputData.insert.length);
                }
        }
    }
    else if(UI.viewBasin instanceof Basin && paused && primaryWrapper.showing){
        if(keyCode===LEFT_ARROW && viewTick>=ADVISORY_TICKS){
            changeViewTick(ceil(viewTick/ADVISORY_TICKS-1)*ADVISORY_TICKS);
        }else if(keyCode===RIGHT_ARROW){
            let t;
            if(viewTick<UI.viewBasin.tick-ADVISORY_TICKS) t = floor(viewTick/ADVISORY_TICKS+1)*ADVISORY_TICKS;
            else t = UI.viewBasin.tick;
            changeViewTick(t);
        }
    }
}

function keyTyped(){
    // console.log(`keyTyped: ${key} / ${keyCode}`);
    if(UI.focusedInput){
        UI.inputData.insert = key;
        return false;
    }
}

function keyReleased(){
    UI.inputData.insert = '';
}

function changeViewTick(t){
    let oldS = UI.viewBasin.getSeason(viewTick);
    viewTick = t;
    let newS = UI.viewBasin.getSeason(viewTick);
    let finish = ()=>{
        refreshTracks(oldS!==newS);
        UI.viewBasin.env.displayLayer();
    };
    let requisites = s=>{
        let arr = [];
        let allFound = true;
        for(let i=0;i<s.systems.length;i++){
            let r = s.systems[i];
            if(r instanceof StormRef && (r.lastApplicableAt===undefined || r.lastApplicableAt>=viewTick || simSettings.trackMode===2)){
                arr.push(r.season);
                allFound = allFound && UI.viewBasin.fetchSeason(r.season);
            }
        }
        if(allFound) finish();
        else{
            for(let i=0;i<arr.length;i++){
                arr[i] = UI.viewBasin.fetchSeason(arr[i],false,false,true);
            }
            Promise.all(arr).then(finish);
        }
    };
    if(UI.viewBasin.fetchSeason(viewTick,true)){
        requisites(UI.viewBasin.fetchSeason(viewTick,true));
    }else UI.viewBasin.fetchSeason(viewTick,true,false,s=>{
        requisites(s);
    });
}

// function deviceTurned(){
//     toggleFullscreen();
// }

function wrapText(str,w){
    let newStr = "";
    for(let i = 0, j = 0;i<str.length;i=j){
        if(str.charAt(i)==='\n'){
            i++;
            j++;
            newStr += '\n';
            continue;
        }
        j = str.indexOf('\n',i);
        if(j===-1) j = str.length;
        let line = str.slice(i,j);
        while(textWidth(line)>w){
            let k=0;
            while(textWidth(line.slice(0,k))<=w) k++;
            k--;
            if(k<1){
                newStr += line.charAt(0) + '\n';
                line = line.slice(1);
                continue;
            }
            let l = line.lastIndexOf(' ',k-1);
            if(l!==-1){
                newStr += line.slice(0,l) + '\n';
                line = line.slice(l+1);
                continue;
            }
            let sub = line.slice(0,k);
            l = sub.search(/\W(?=\w*$)/);
            if(l!==-1){
                newStr += line.slice(0,l+1) + '\n';
                line = line.slice(l+1);
                continue;
            }
            newStr += sub + '\n';
            line = line.slice(k);
        }
        newStr += line;
    }
    return newStr;
}

function countTextLines(str){
    let l = 1;
    for(let i=0;i<str.length;i++) if(str.charAt(i)==='\n') l++;
    return l;
}

function ktsToMph(k,rnd){
    let val = k*1.15078;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function ktsToKmh(k,rnd){
    let val = k*1.852;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function displayWindspeed(kts, rnd){
    if(!rnd)
        rnd = WINDSPEED_ROUNDING;
    let value = [kts, ktsToMph(kts,rnd), ktsToKmh(kts,rnd)][simSettings.speedUnit];
    let unitLabel = ['kts', 'mph', 'km/h'][simSettings.speedUnit];
    return `${value} ${unitLabel}`;
}

function oneMinToTenMin(w,rnd){
    let val = w*7/8;    // simple ratio
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

function mbToInHg(mb,rnd){
    let val = mb*0.02953;
    if(rnd) val = round(val/rnd)*rnd;
    return val;
}

// converts a radians-from-east angle into a degrees-from-north heading with compass direction for display formatting
function compassHeading(rad){
    // force rad into range of zero to two-pi
    if(rad < 0)
        rad = 2*PI - (-rad % (2*PI));
    else
        rad = rad % (2*PI);
    // convert heading from radians-from-east to degrees-from-north
    let heading = map(rad,0,2*PI,90,450) % 360;
    let compass;
    // calculate compass direction
    if(heading < 11.25)
        compass = 'N';
    else if(heading < 33.75)
        compass = 'NNE';
    else if(heading < 56.25)
        compass = 'NE';
    else if(heading < 78.75)
        compass = 'ENE';
    else if(heading < 101.25)
        compass = 'E';
    else if(heading < 123.75)
        compass = 'ESE';
    else if(heading < 146.25)
        compass = 'SE';
    else if(heading < 168.75)
        compass = 'SSE';
    else if(heading < 191.25)
        compass = 'S';
    else if(heading < 213.75)
        compass = 'SSW';
    else if(heading < 236.25)
        compass = 'SW';
    else if(heading < 258.75)
        compass = 'WSW';
    else if(heading < 281.25)
        compass = 'W';
    else if(heading < 303.75)
        compass = 'WNW';
    else if(heading < 326.25)
        compass = 'NW';
    else if(heading < 348.75)
        compass = 'NNW';
    else
        compass = 'N';
    heading = round(heading);
    return heading + '\u00B0 '/* degree sign */ + compass;
}

function damageDisplayNumber(d){
    if(d===0) return "none";
    if(d<50000000) return "minimal";
    if(d<1000000000) return "$ " + (round(d/1000)/1000) + " M";
    if(d<1000000000000) return "$ " + (round(d/1000000)/1000) + " B";
    return "$ " + (round(d/1000000000)/1000) + " T";
}

function formatDate(m){
    if(m instanceof moment){
        const f = 'HH[z] MMM DD';
        let str = m.format(f);
        let y = m.year();
        let bce;
        if(y<1){
            y = 1-y;
            bce = true;
        }
        str += ' ' + zeroPad(y,4);
        if(bce) str += ' B.C.E.';
        return str;
    }
}

function seasonName(y,h){
    if(h===undefined) h = UI.viewBasin instanceof Basin && UI.viewBasin.SHem;
    let str = '';
    let eraYear = yr=>{
        if(yr<1) return 1-yr;
        return yr;
    };
    const bce = ' B.C.E.';
    if(h){
        str += zeroPad(eraYear(y-1),4);
        if(y===1) str += bce;
        str += '-' + zeroPad(eraYear(y)%100,2);
        if(y<1) str += bce;
        return str;
    }
    str += zeroPad(eraYear(y),4);
    if(y<1) str += bce;
    return str;
}
```
