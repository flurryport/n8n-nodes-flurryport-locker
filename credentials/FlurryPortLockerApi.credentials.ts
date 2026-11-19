import type { IAuthenticateGeneric, Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * The install key (an fp_ token scoped to one Locker install) and the API base. Issued from the
 * install's key page in FlurryPORT and pasted here; never minted from n8n. The credential test
 * reads the account's installs.
 */
export class FlurryPortLockerApi implements ICredentialType {
  name = 'flurryPortLockerApi';
  displayName = 'FlurryPORT Locker API';
  icon: Icon = {
    light: 'file:../nodes/FlurryPortLocker/flurryport-locker.svg',
    dark: 'file:../nodes/FlurryPortLocker/flurryport-locker.dark.svg',
  };
  documentationUrl = 'https://flurryport.io/docs/locker/n8n';
  properties: INodeProperties[] = [
    {
      displayName: 'Install key',
      name: 'installKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'The key shown once on the install page in FlurryPORT. It starts with fp_.',
    },
    {
      displayName: 'API base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.flurryport.io',
      description: 'Leave as is unless FlurryPORT told you otherwise.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.installKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/locker/installs',
      method: 'GET',
    },
  };
}
