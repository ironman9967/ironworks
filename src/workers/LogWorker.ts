
import async = require('async');
import _ = require('lodash');
import JsonStringifySafe = require('json-stringify-safe');

import idHelper = require('../helpers/idHelper');

import ICollection = require('../interfaces/collection/ICollection');
import Collection = require('../collection/Collection');
import IComm = require('../interfaces/eventing/IComm');
import IAm = require('../interfaces/whoIAm/IAm');
import IWorker = require('../interfaces/workers/IWorker');
import ICommEmit = require('../interfaces/eventing/ICommEmit');
import CommEvent = require('../eventing/CommEvent');
import ICommEvent = require('../interfaces/eventing/ICommEvent');
import ICommEventData = require('../interfaces/eventing/ICommEventData');
import IServiceListener = require('../interfaces/service/IServiceListener');

import ILogWorkerOpts = require('../interfaces/opts/ILogWorkerOpts');
import ILogEntry = require('../interfaces/workers/ILogEntry');
import Worker = require('./Worker');

class LogWorker extends Worker implements IWorker {
    private writeStdout: Function;
    private writeStderr: Function;

    private level: number;
    private defLevel: number;

    private serviceListeners: IServiceListener[];

    constructor(opts?: ILogWorkerOpts) {
        super([], {
            id: idHelper.newId(),
            name: 'iw-log'
        }, opts);
        
        if (_.isUndefined(opts) || (_.isUndefined(opts.stdout) && _.isUndefined(this.writeStdout))) {
            this.writeStdout = console.log;
        }
        else {
            this.writeStdout = opts.stdout;
        }
        if (_.isUndefined(opts) || (_.isUndefined(opts.stderr) && _.isUndefined(this.writeStderr))) {
            this.writeStderr = console.error;
        }
        else {
            this.writeStderr = opts.stderr;
        }

        var defOpts: ILogWorkerOpts = {
            level: 500,
            defaultLevel: 500
        };
        this.opts = this.opts.beAdoptedBy<ILogWorkerOpts>(defOpts, 'worker');
        this.opts.merge(opts);

        this.level = this.opts.get<number>('level');
        this.defLevel = this.opts.get<number>('defaultLevel');

        this.serviceListeners = [];
    }

    public preInit(comm, whoService, cb): IWorker {
        this.comm = comm;
        this.whoService = whoService;
        this.info<IServiceListener[]>('iw-service.available-listeners', (listeners) => {
            this.serviceListeners = listeners;
        });
        this.info<ILogEntry>('log', (entry) => {});
        this.intercept('*.*.*.*', {
            preEmit: (stop, next, anno, ...args) => {
                var logLevel = this.defLevel;
                if (!_.isUndefined(anno.log) && !_.isUndefined(anno.log.level)) {
                    logLevel = anno.log.level;
                }
                if (logLevel > this.level) {
                    next(args);
                }
                else {
                    var meta = args[0];
                    var emitterObj = void 0;
                    var cb = void 0;
                    if (args.length === 2) {
                        if (_.isFunction(args[1])) {
                            cb = args[1];
                        }
                        else {
                            emitterObj = args[1];
                        }
                    }
                    if (args.length === 3) {
                        emitterObj = args[1];
                        cb = args[2];
                    }
                    var nextArgs = [ meta ];
                    var emitterObjLog = void 0;
                    if (!_.isUndefined(emitterObj)) {
                        emitterObjLog = _.clone(emitterObj);
                        if (!_.isUndefined(anno.log)) {
							if (!_.isEmpty(anno.log.properties)) {
	                            _.each(anno.log.properties, (prop: any) => {
	                                var emittedProp = (<any>_).get(emitterObjLog, prop.name);
	                                if (!_.isUndefined(emittedProp)) {
	                                    if (!_.isUndefined(prop.level) && prop.level > this.level) {
	                                        emittedProp = void 0;
	                                    }
	                                    else if (!_.isUndefined(prop.secure) && prop.secure) {
	                                        emittedProp = '*****';
	                                    }
	                                    else if (!_.isUndefined(prop.arrayLengthOnly) && prop.arrayLengthOnly && _.isArray(emittedProp)) {
	                                        emittedProp = 'array[' + emittedProp.length + ']';
	                                    }
	                                    (<any>_).set(emitterObjLog, prop.name, emittedProp);
	                                }
	                            });
	                        }
							else if (!_.isEmpty(anno.log.emittedObject)) {
								if (!_.isUndefined(anno.log.emittedObject.arrayLengthOnly) && anno.log.emittedObject.arrayLengthOnly && _.isArray(emitterObjLog)) {
									emitterObjLog = 'array[' + emitterObjLog.length + ']';
								}
							}
						}
                        nextArgs.push(emitterObj);
                        if (!this.interceptListener(this.getCommEvent(meta)) || _.isUndefined(cb)) {
                            if (emitterObj instanceof Error) {
                                this.error(meta, anno, emitterObj);
                            }
                            else {
                                this.log(meta, anno, emitterObjLog);
                            }
                        }
                    }
                    if (!_.isUndefined(cb)) {
                        nextArgs.push((...listenerArgs: any[]) => {
                            var e = listenerArgs[0];
                            var listenerRes;
                            if (listenerArgs.length > 1) {
                                listenerRes = listenerArgs[1];
                            }
                            if (e !== null) {
                                this.error(meta, anno, e, emitterObj);
                            }
                            else {
                                this.log(meta, anno, emitterObjLog, listenerRes);
                            }
                            cb(e, listenerRes);
                        });
                    }
                    else if (_.isUndefined(emitterObj)) {
                        this.log(meta, anno);
                    }
                    next(nextArgs);
                }
            }
        });
        super.preInit(comm, whoService, cb);
        return this;
    }
    
    public postInit(deps, cb): IWorker {
        this.comm.on('newListener', (event) => {
            if (this.getCommEvent(event).name !== 'newListener') {
                this.ask<IServiceListener[]>('iw-service.list-listeners', (e, listeners) => {
                    if (e === null) {
                        this.serviceListeners = listeners;
                    }
                });
            }
        });
        return super.postInit(deps, cb);
    }

    private interceptListener(evt: ICommEventData): boolean {
        return this.hasListener(evt)
            || (<any>_).any(this.serviceListeners, (srvListener: IServiceListener) => {
                return CommEvent.equal(evt, srvListener.commEvent);
            })
            || evt.name === 'error'
            || evt.name === 'warn';
    }

    private log(meta: ICommEmit, anno: any, emitterObj?: any, listenerRes?: any) {
        process.nextTick(() => {
            var entry: any = {
                meta: meta,
                anno: anno
            };
            if (!_.isUndefined(emitterObj)) {
                entry.emitted = emitterObj;
            }
            if (!_.isUndefined(listenerRes)) {
                entry.emitted = listenerRes;
            }
            var json = JsonStringifySafe(entry);
            this.writeStdout(json);
        });
    }

    private error(meta: ICommEmit, anno: any, error: Error, emitterObj?: any) {
        process.nextTick(() => {
            var entry: any = {
                meta: meta,
                anno: anno
            };
            if (error !== null) {
                if (error instanceof Error) {
                    entry.error = error.message;
                    entry.stack = error.stack.substring(error.stack.indexOf('at', 7 + error.message.length));
                    entry = _.merge(entry, _.omit(error, ['message', 'stack']));
                }
                if (_.isString(error)) {
                    entry.error = error;
                }
                if (_.isObject(error)) {
                    entry = _.merge(entry, error);
                }
            }
            if (!_.isUndefined(emitterObj)) {
                entry.emitted = emitterObj;
            }
            var json = JsonStringifySafe(entry);
            this.writeStderr(json);
        });
    }
}

export = LogWorker;
