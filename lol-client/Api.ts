/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

/** Team identification */
export enum TeamID {
  UNKNOWN = "UNKNOWN",
  ORDER = "ORDER",
  CHAOS = "CHAOS",
  NEUTRAL = "NEUTRAL",
}

/** Serialization format for remoting requests and results. */
export enum RemotingSerializedFormat {
  JSON = "JSON",
  YAML = "YAML",
  MsgPack = "MsgPack",
}

/** Well-known privilege levels for bindable functions. */
export enum RemotingPrivilege {
  None = "None",
  User = "User",
  Admin = "Admin",
  Local = "Local",
}

/** Help format for remoting functions and types. */
export enum RemotingHelpFormat {
  Full = "Full",
  Epytext = "Epytext",
  Brief = "Brief",
  Console = "Console",
}

/** Help format for binding functions and types. */
export enum BindingHelpFormat {
  Full = "Full",
  Epytext = "Epytext",
}

/** Possible states of an asynchronous operation. */
export enum BindingAsyncState {
  None = "None",
  Running = "Running",
  Cancelling = "Cancelling",
  Cancelled = "Cancelled",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

/** Ability Resource */
export enum AbilityResource {
  MANA = "MANA",
  ENERGY = "ENERGY",
  NONE = "NONE",
  SHIELD = "SHIELD",
  BATTLEFURY = "BATTLEFURY",
  DRAGONFURY = "DRAGONFURY",
  RAGE = "RAGE",
  HEAT = "HEAT",
  GNARFURY = "GNARFURY",
  FEROCITY = "FEROCITY",
  BLOODWELL = "BLOODWELL",
  WIND = "WIND",
  AMMO = "AMMO",
  MOONLIGHT = "MOONLIGHT",
  OTHER = "OTHER",
  MAX = "MAX",
}

/** Represents a cancelled asynchronous operation. */
export interface BindingAsyncCancelEvent {
  /**
   * Asynchronous operation token
   * @format int32
   */
  asyncToken?: number;
}

/** Represents a failed asynchronous operation. */
export interface BindingAsyncFailureEvent {
  /**
   * Asynchronous operation token
   * @format int32
   */
  asyncToken?: number;
  /** Error message */
  error?: string;
}

/** Represents the parameters of a call to a provided callback. */
export interface BindingCallbackEvent {
  /**
   * ID of the callback being invoked
   * @format int32
   */
  id?: number;
  /** Callback parameters */
  parameters?: Record<string, any>[];
}

/** Describes the exposed native API. */
export interface BindingFullApiHelp {
  events?: BindingFullEventHelp[];
  functions?: BindingFullFunctionHelp[];
  types?: BindingFullTypeHelp[];
}

/** Describes a function parameter. */
export interface BindingFullArgumentHelp {
  description?: string;
  name?: string;
  optional?: boolean;
  /** Describes the type of a value. */
  type?: BindingFullTypeIdentifier;
}

/** Describes an enumerator. */
export interface BindingFullEnumValueHelp {
  description?: string;
  name?: string;
  /** @format int32 */
  value?: number;
}

/** Describes an event. */
export interface BindingFullEventHelp {
  description?: string;
  name?: string;
  nameSpace?: string;
  tags?: string[];
  /** Describes the type of a value. */
  type?: BindingFullTypeIdentifier;
}

/** Describes a member of a struct. */
export interface BindingFullFieldHelp {
  description?: string;
  name?: string;
  /** @format int32 */
  offset?: number;
  optional?: boolean;
  /** Describes the type of a value. */
  type?: BindingFullTypeIdentifier;
}

/** Describes a function. */
export interface BindingFullFunctionHelp {
  arguments?: BindingFullArgumentHelp[];
  async?: string;
  description?: string;
  help?: string;
  name?: string;
  nameSpace?: string;
  /** Describes the type of a value. */
  returns?: BindingFullTypeIdentifier;
  tags?: string[];
  threadSafe?: boolean;
}

/** Describes a struct or enum type. */
export interface BindingFullTypeHelp {
  description?: string;
  fields?: BindingFullFieldHelp[];
  name?: string;
  nameSpace?: string;
  /** @format int32 */
  size?: number;
  tags?: string[];
  values?: BindingFullEnumValueHelp[];
}

/** Describes the type of a value. */
export interface BindingFullTypeIdentifier {
  elementType?: string;
  type?: string;
}

/** Represents generic data for an asynchronous event. */
export interface BindingGenericAsyncEvent {
  /**
   * Asynchronous operation token
   * @format int32
   */
  asyncToken?: number;
  /** Event data */
  data?: Record<string, any>;
}

/** Represents generic data for an event. */
export interface BindingGenericEvent {
  /** Event data */
  data?: Record<string, any>;
}

/** Color */
export interface Color {
  a?: number;
  b?: number;
  g?: number;
  r?: number;
}

/** 2D vector */
export interface Vector2F {
  /** @format float */
  x?: number;
  /** @format float */
  y?: number;
}

/** 3D vector */
export interface Vector3F {
  /** @format float */
  x?: number;
  /** @format float */
  y?: number;
  /** @format float */
  z?: number;
}

/** 4D vector */
export interface Vector4F {
  /** @format float */
  w?: number;
  /** @format float */
  x?: number;
  /** @format float */
  y?: number;
  /** @format float */
  z?: number;
}

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<
  FullRequestParams,
  "body" | "method" | "query" | "path"
>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (
    securityData: SecurityDataType | null,
  ) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown>
  extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  JsonApi = "application/vnd.api+json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) =>
    fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter(
      (key) => "undefined" !== typeof query[key],
    );
    return keys
      .map((key) =>
        Array.isArray(query[key])
          ? this.addArrayQueryParam(query, key)
          : this.addQueryParam(query, key),
      )
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.JsonApi]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.Text]: (input: any) =>
      input !== null && typeof input !== "string"
        ? JSON.stringify(input)
        : input,
    [ContentType.FormData]: (input: any) =>
      Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
              ? JSON.stringify(property)
              : `${property}`,
        );
        return formData;
      }, new FormData()),
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(
    params1: RequestParams,
    params2?: RequestParams,
  ): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (
    cancelToken: CancelToken,
  ): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(
      `${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`,
      {
        ...requestParams,
        headers: {
          ...(requestParams.headers || {}),
          ...(type && type !== ContentType.FormData
            ? { "Content-Type": type }
            : {}),
        },
        signal:
          (cancelToken
            ? this.createAbortSignal(cancelToken)
            : requestParams.signal) || null,
        body:
          typeof body === "undefined" || body === null
            ? null
            : payloadFormatter(body),
      },
    ).then(async (response) => {
      const r = response.clone() as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const data = !responseFormat
        ? r
        : await response[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title LoLClient
 * @version 1.0.0
 *
 * League of Legends Game Client
 */
export class Api<
  SecurityDataType extends unknown,
> extends HttpClient<SecurityDataType> {
  asyncDelete = {
    /**
     * No description
     *
     * @tags builtin
     * @name AsyncDelete
     * @summary Cancels the asynchronous operation or removes its completion status.
     * @request POST:/AsyncDelete
     */
    asyncDelete: (
      query: {
        /**
         * ID of the asynchronous operation to remove
         * @format int32
         */
        asyncToken: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/AsyncDelete`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  asyncResult = {
    /**
     * No description
     *
     * @tags builtin
     * @name AsyncResult
     * @summary Retrieves the result of a completed asynchronous operation.
     * @request POST:/AsyncResult
     */
    asyncResult: (
      query: {
        /**
         * ID of the asynchronous operation to check
         * @format int32
         */
        asyncToken: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/AsyncResult`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  asyncStatus = {
    /**
     * No description
     *
     * @tags builtin
     * @name AsyncStatus
     * @summary Retrieves details on the current state of an asynchronous operation.
     * @request POST:/AsyncStatus
     */
    asyncStatus: (
      query: {
        /**
         * ID of the asynchronous operation to check
         * @format int32
         */
        asyncToken: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/AsyncStatus`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  cancel = {
    /**
     * No description
     *
     * @tags builtin
     * @name Cancel
     * @summary Attempts to cancel an asynchronous operation
     * @request POST:/Cancel
     */
    cancel: (
      query: {
        /**
         * Operation to cancel
         * @format int32
         */
        asyncToken: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/Cancel`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  exit = {
    /**
     * No description
     *
     * @tags builtin
     * @name Exit
     * @summary Closes the connection.
     * @request POST:/Exit
     */
    exit: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/Exit`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  help = {
    /**
     * @description With no arguments, returns a list of all available functions and types along with a short description. If a function or type is specified, returns detailed information about it.
     *
     * @tags builtin
     * @name Help
     * @summary Returns information on available functions and types
     * @request POST:/Help
     */
    help: (
      query?: {
        /** Name of the function or type to describe */
        target?: string;
        /** Format for returned information */
        format?: "Full" | "Epytext" | "Brief" | "Console";
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/Help`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  subscribe = {
    /**
     * No description
     *
     * @tags builtin
     * @name Subscribe
     * @summary Subscribes to a given event
     * @request POST:/Subscribe
     */
    subscribe: (
      query: {
        /** Name of the event to subscribe to */
        eventName: string;
        /** Desired format to receive events in. If unspecified, events will be sent in the active result format at the time. */
        format?: "JSON" | "YAML" | "MsgPack";
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/Subscribe`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  unsubscribe = {
    /**
     * No description
     *
     * @tags builtin
     * @name Unsubscribe
     * @summary Unsubscribes from a given event
     * @request POST:/Unsubscribe
     */
    unsubscribe: (
      query: {
        /** Name of the event to unsubscribe from */
        eventName: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/Unsubscribe`,
        method: "POST",
        query: query,
        format: "json",
        ...params,
      }),
  };
  async = {
    /**
     * No description
     *
     * @tags builtin
     * @name HttpAsyncResult
     * @summary Retrieves the result of a completed asynchronous operation.
     * @request GET:/async/v1/result/{asyncToken}
     */
    httpAsyncResult: (asyncToken: any, params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/async/v1/result/${asyncToken}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags builtin
     * @name HttpAsyncDelete
     * @summary Cancels the asynchronous operation or removes its completion status.
     * @request DELETE:/async/v1/status/{asyncToken}
     */
    httpAsyncDelete: (asyncToken: any, params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/async/v1/status/${asyncToken}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags builtin
     * @name HttpAsyncStatus
     * @summary Retrieves details on the current state of an asynchronous operation.
     * @request GET:/async/v1/status/{asyncToken}
     */
    httpAsyncStatus: (asyncToken: any, params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/async/v1/status/${asyncToken}`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
  liveclientdata = {
    /**
     * No description
     *
     * @tags champions, activePlayer
     * @name GetLiveclientdataActiveplayer
     * @summary Get all data about the active player
     * @request GET:/liveclientdata/activeplayer
     */
    getLiveclientdataActiveplayer: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/activeplayer`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags champions, abilities, activePlayer
     * @name GetLiveclientdataActiveplayerabilities
     * @summary Get Abilities for the active player
     * @request GET:/liveclientdata/activeplayerabilities
     */
    getLiveclientdataActiveplayerabilities: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/activeplayerabilities`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags activePlayer
     * @name GetLiveclientdataActiveplayername
     * @summary Returns the player name
     * @request GET:/liveclientdata/activeplayername
     */
    getLiveclientdataActiveplayername: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/liveclientdata/activeplayername`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags runes, activePlayer
     * @name GetLiveclientdataActiveplayerrunes
     * @summary Retrieve the full list of runes for the active player
     * @request GET:/liveclientdata/activeplayerrunes
     */
    getLiveclientdataActiveplayerrunes: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/activeplayerrunes`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags all
     * @name GetLiveclientdataAllgamedata
     * @summary Get all available data
     * @request GET:/liveclientdata/allgamedata
     */
    getLiveclientdataAllgamedata: (
      query?: {
        /**
         * ID of the next event you expect to see
         * @format int32
         */
        eventID?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/allgamedata`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags champions, events
     * @name GetLiveclientdataEventdata
     * @summary Get a list of events that have occurred in the game
     * @request GET:/liveclientdata/eventdata
     */
    getLiveclientdataEventdata: (
      query?: {
        /**
         * ID of the next event you expect to see
         * @format int32
         */
        eventID?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/eventdata`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags game
     * @name GetLiveclientdataGamestats
     * @summary Basic data about the game
     * @request GET:/liveclientdata/gamestats
     */
    getLiveclientdataGamestats: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/gamestats`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags items, allPlayers
     * @name GetLiveclientdataPlayeritems
     * @summary Retrieve the list of items for the player
     * @request GET:/liveclientdata/playeritems
     */
    getLiveclientdataPlayeritems: (
      query: {
        /** RiotID GameName (with tag) of the player in the format Name#TAG */
        riotId: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/playeritems`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags champions, units, allPlayers
     * @name GetLiveclientdataPlayerlist
     * @summary Retrieve the list of heroes in the game and their stats
     * @request GET:/liveclientdata/playerlist
     */
    getLiveclientdataPlayerlist: (
      query?: {
        /** Heroes team ID. Optional, returns all players on all teams if null.  */
        teamID?: "UNKNOWN" | "ORDER" | "CHAOS" | "NEUTRAL";
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/playerlist`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags allPlayers, runes
     * @name GetLiveclientdataPlayermainrunes
     * @summary Retrieve the basic runes of any player
     * @request GET:/liveclientdata/playermainrunes
     */
    getLiveclientdataPlayermainrunes: (
      query: {
        /** RiotID GameName (with tag) of the player in the format Name#TAG */
        riotId: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/playermainrunes`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags allPlayers, scores
     * @name GetLiveclientdataPlayerscores
     * @summary Retrieve the list of the current scores for the player
     * @request GET:/liveclientdata/playerscores
     */
    getLiveclientdataPlayerscores: (
      query: {
        /** RiotID GameName (with tag) of the player in the format Name#TAG */
        riotId: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/playerscores`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags allPlayers
     * @name GetLiveclientdataPlayersummonerspells
     * @summary Retrieve the list of the summoner spells for the player
     * @request GET:/liveclientdata/playersummonerspells
     */
    getLiveclientdataPlayersummonerspells: (
      query: {
        /** RiotID GameName (with tag) of the player in the format Name#TAG */
        riotId: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<Record<string, any>, any>({
        path: `/liveclientdata/playersummonerspells`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  swagger = {
    /**
     * No description
     *
     * @tags builtin
     * @name HttpApiDocsV1
     * @summary Retrieves the API documentation resource listing
     * @request GET:/swagger/v1/api-docs
     */
    httpApiDocsV1: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/swagger/v1/api-docs`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags builtin
     * @name HttpApiDeclarationV1
     * @summary Retrieves the API declaration for a supported API
     * @request GET:/swagger/v1/api-docs/{api}
     */
    httpApiDeclarationV1: (api: any, params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/swagger/v1/api-docs/${api}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags builtin
     * @name HttpApiDocsV2
     * @summary Retrieves the API documentation
     * @request GET:/swagger/v2/swagger.json
     */
    httpApiDocsV2: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/swagger/v2/swagger.json`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags builtin
     * @name HttpApiDocsV3
     * @summary Retrieves the API documentation
     * @request GET:/swagger/v3/openapi.json
     */
    httpApiDocsV3: (params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/swagger/v3/openapi.json`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
}
